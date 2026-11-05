<#
Testimus installer: per user, no admin rights, safe to rerun.
Rerunning a newer release updates, an older one rolls back. Settings, credentials, models and
projects live outside the versioned folder and are never touched.

  powershell -ExecutionPolicy Bypass -File install.ps1 [-Root <dir>] [-InstallClaude]
             [-NoPath] [-NoShortcut] [-NoDesktop] [-ShortcutDir <dir>] [-NoSetup] [-NoPrompt] [-Keep <n>]

Start-menu shortcuts: "Testimus" runs the desktop app (Testimus.exe), "Testimus (browser)" runs
testimus serve. -NoDesktop keeps one "Testimus" shortcut that runs testimus serve.
-ShortcutDir puts the shortcuts in another folder than the Start menu (for trials).

Updates: <Root>\install.json remembers the folder this release came from; Testimus looks for newer
releases in that folder (or the one set in Settings > Updates) and runs their install.ps1 the same way.
A copy that does not match the release's release.json (files, bytes) is refused and removed.
-Keep is how many installed versions stay (default 2: the new one and the one before, for rollback).
#>
param(
  [string]$Root = (Join-Path $env:LOCALAPPDATA "Testimus"),
  [switch]$InstallClaude,
  [switch]$NoPath,
  [switch]$NoShortcut,
  [switch]$NoDesktop,
  [string]$ShortcutDir = "",
  [switch]$NoSetup,
  [switch]$NoPrompt,
  [int]$Keep = 2
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot

function Say($text) { Write-Host "testimus: $text" }

function Ask($question) {
  if ($NoPrompt -or -not [Environment]::UserInteractive) { return $false }
  try { $a = Read-Host "$question [y/N]" } catch { return $false }
  return $a -match '^(y|yes|o|oui)$'
}

$pkgFile = Join-Path $src "app\package.json"
if (-not (Test-Path $pkgFile)) { throw "Run install.ps1 from a Testimus release folder (app\package.json not found in $src)." }
$version = (Get-Content $pkgFile -Raw | ConvertFrom-Json).version
$Root = [IO.Path]::GetFullPath($Root)
$dest = Join-Path $Root $version
$bin = Join-Path $Root "bin"

# 1. copy the release to <Root>\<version>
New-Item -ItemType Directory -Force -Path $Root, $bin | Out-Null
$srcFull = [IO.Path]::GetFullPath($src).TrimEnd('\')
$copied = $srcFull -ne $dest.TrimEnd('\')
if ($copied) {
  Say "copying $version to $dest"
  & robocopy $src $dest /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) copying $src to $dest" }
}
$global:LASTEXITCODE = 0

# a release still being copied to the shared folder is refused before it becomes current
$metaFile = Join-Path $src "release.json"
$meta = $null
if (Test-Path -LiteralPath $metaFile) {
  $meta = Get-Content -LiteralPath $metaFile -Raw | ConvertFrom-Json
  if ($meta.files) {
    $self = Join-Path $dest "release.json"
    $got = @(Get-ChildItem -LiteralPath $dest -Recurse -File | Where-Object { $_.FullName -ne $self })
    $bytes = ($got | Measure-Object -Property Length -Sum).Sum
    if ($got.Count -ne [int64]$meta.files -or $bytes -ne [int64]$meta.bytes) {
      if ($copied) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
      throw "The release in $src is incomplete ($($got.Count) of $($meta.files) files): it is probably still being copied. Try again in a few minutes."
    }
  }
}

# a release copied from Teams or a browser download carries the Mark of the Web: drop it (per user, no admin)
Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File

# 2. make it current and write the shim that follows current.txt
[IO.File]::WriteAllText((Join-Path $Root "current.txt"), $version, [Text.Encoding]::ASCII)

# where this release came from and how it was installed. Newer releases are looked for in the folder its
# release.json names (set when it was published), else in its parent folder; a mapped drive (Z:\) is kept as its
# \\server\share path, which every PC can read whatever letter it gives the share
function UncOf($path) {
  if ($path -match '^([A-Za-z]):\\') {
    try {
      $drive = Get-PSDrive -Name $Matches[1] -PSProvider FileSystem -ErrorAction Stop
      if ($drive.DisplayRoot -and $drive.DisplayRoot.StartsWith('\\')) { return $drive.DisplayRoot.TrimEnd('\') + $path.Substring(2) }
    } catch {}
  }
  return $path
}
$infoFile = Join-Path $Root "install.json"
$channel = ""
$from = ""
if ($copied) {
  $from = UncOf $srcFull
  $channel = Split-Path -Parent $from
  if (-not $channel) { $channel = $from }
  if ($meta -and $meta.channel) { $channel = [string]$meta.channel }
} elseif (Test-Path -LiteralPath $infoFile) {
  try {
    $old = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
    $from = [string]$old.from
    $channel = [string]$old.channel
  } catch {}
}
$info = [ordered]@{
  version = $version
  from = $from
  channel = $channel
  at = (Get-Date).ToString("o")
  options = [ordered]@{ noPath = [bool]$NoPath; noShortcut = [bool]$NoShortcut; noDesktop = [bool]$NoDesktop; shortcutDir = $ShortcutDir }
}
[IO.File]::WriteAllText($infoFile, ($info | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))

# older versions go, but the -Keep newest, the current one and any still running stay
$installed = @(Get-ChildItem -LiteralPath $Root -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "app\package.json") } | ForEach-Object {
  $v = $null
  if ([version]::TryParse(($_.Name -replace '-.*$', ''), [ref]$v)) { [pscustomobject]@{ Dir = $_; Version = $v } }
} | Sort-Object -Property Version -Descending)
$running = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch { $null } } | Where-Object { $_ })
foreach ($old in ($installed | Select-Object -Skip ([Math]::Max($Keep, 1)))) {
  $dir = $old.Dir.FullName
  if ($old.Dir.Name -eq $version) { continue }
  if ($running | Where-Object { $_.StartsWith("$dir\", [StringComparison]::OrdinalIgnoreCase) }) { continue }
  try {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
    Say "removed the old version $($old.Dir.Name)"
  } catch {
    Say "could not remove $dir (in use?): it stays"
  }
}
$shim = @(
  '@echo off',
  'setlocal',
  'set /p TESTIMUS_VERSION=<"%~dp0..\current.txt"',
  'call "%~dp0..\%TESTIMUS_VERSION%\testimus.cmd" %*',
  'exit /b %ERRORLEVEL%'
) -join "`r`n"
[IO.File]::WriteAllText((Join-Path $bin "testimus.cmd"), "$shim`r`n", [Text.Encoding]::ASCII)
$testimus = Join-Path $bin "testimus.cmd"
Say "current = $version ($testimus)"

# 3. user PATH (HKCU, no admin); keeps REG_EXPAND_SZ entries unexpanded
if (-not $NoPath) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  $old = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $parts = @($old -split ';' | Where-Object { $_ -ne "" })
  if ($parts -notcontains $bin) {
    $key.SetValue("Path", (($parts + $bin) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    Say "added $bin to your user PATH (new terminals will see it)"
  }
  $key.Close()
  [Environment]::SetEnvironmentVariable("TESTIMUS_INSTALLED", $version, "User")
  if (($env:Path -split ';') -notcontains $bin) { $env:Path = "$env:Path;$bin" }
}

# 4. Start-menu shortcuts: the desktop app, and the browser mode (testimus serve)
if (-not $NoShortcut) {
  $programs = if ($ShortcutDir) { [IO.Path]::GetFullPath($ShortcutDir) } else { [Environment]::GetFolderPath("Programs") }
  New-Item -ItemType Directory -Force -Path $programs | Out-Null
  $wsh = New-Object -ComObject WScript.Shell
  $icon = Join-Path $dest "testimus.ico"
  if (Test-Path $icon) { Copy-Item $icon (Join-Path $Root "testimus.ico") -Force }
  $exe = Join-Path $dest "Testimus.exe"
  $desktop = (-not $NoDesktop) -and (Test-Path $exe)

  $browserName = if ($desktop) { "Testimus (browser).lnk" } else { "Testimus.lnk" }
  $lnk = $wsh.CreateShortcut((Join-Path $programs $browserName))
  $lnk.TargetPath = $testimus
  $lnk.Arguments = "serve"
  $lnk.WorkingDirectory = $env:USERPROFILE
  $lnk.WindowStyle = 7
  $lnk.Description = "Testimus $version in the browser"
  if (Test-Path $icon) { $lnk.IconLocation = "$(Join-Path $Root 'testimus.ico'),0" }
  $lnk.Save()

  if ($desktop) {
    $lnk = $wsh.CreateShortcut((Join-Path $programs "Testimus.lnk"))
    $lnk.TargetPath = $exe
    $lnk.Arguments = ""
    $lnk.WorkingDirectory = $env:USERPROFILE
    $lnk.WindowStyle = 1
    $lnk.Description = "Testimus $version"
    $lnk.IconLocation = "$exe,0"
    $lnk.Save()
    Say "shortcuts in ${programs}: Testimus (desktop app), Testimus (browser)"
  } else {
    Remove-Item -LiteralPath (Join-Path $programs "Testimus (browser).lnk") -ErrorAction SilentlyContinue
    Say "shortcut in ${programs}: Testimus (browser mode)"
  }
}

# 5. Claude Code CLI
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude -and (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) { $claude = "$env:USERPROFILE\.local\bin\claude.exe" }
if ($claude) {
  Say "Claude Code found"
} elseif ($InstallClaude -or (Ask "Claude Code is not installed. Install it now with Anthropic's installer?")) {
  Say "installing Claude Code (https://claude.ai/install.ps1)"
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Say "open a new terminal, run 'claude' once and sign in with your Claude subscription"
} else {
  Say "Claude Code is missing: install it later with  irm https://claude.ai/install.ps1 | iex"
}

if ($NoSetup) {
  Say "installed $version (setup and doctor skipped)"
  exit 0
}

# 6. credentials: ask only for what is missing
try { $status = (& $testimus system credentials --json | Out-String | ConvertFrom-Json).status } catch { $status = $null }
if (-not $status) {
  Say "testimus did not start (system credentials failed): run '$testimus system doctor' to see why"
  exit 1
}
$setupArgs = @()
if ($NoPrompt -or -not [Environment]::UserInteractive) {
  if (-not ($status.jira.complete -and $status.xray.complete)) {
    Say "credentials incomplete: run 'testimus system setCredentials' later (prompts skipped with -NoPrompt)"
  }
} elseif (-not $status.jira.complete) {
  Say "Jira access ($($status.jira.file))"
  if (-not $status.jira.baseUrl) { $site = Read-Host "  Jira site (e.g. company or https://company.atlassian.net)"; if ($site) { $setupArgs += @("--site", $site) } }
  if (-not $status.jira.email) { $email = Read-Host "  Atlassian email"; if ($email) { $setupArgs += @("--email", $email) } }
  $sec = Read-Host "  Jira API token (https://id.atlassian.com/manage-profile/security/api-tokens)" -AsSecureString
  $env:TESTIMUS_JIRA_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not ($NoPrompt -or -not [Environment]::UserInteractive) -and -not $status.xray.complete) {
  Say "Xray access ($($status.xray.file))"
  $cid = Read-Host "  Xray client id"
  if ($cid) { $setupArgs += @("--client-id", $cid) }
  $sec = Read-Host "  Xray client secret" -AsSecureString
  $env:TESTIMUS_XRAY_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
& $testimus system setCredentials @setupArgs
Remove-Item Env:TESTIMUS_JIRA_TOKEN, Env:TESTIMUS_XRAY_SECRET -ErrorAction SilentlyContinue

# 7. doctor
& $testimus system doctor
Say "installed $version. Start it from the Start menu (Testimus), or in the browser with: testimus serve"
