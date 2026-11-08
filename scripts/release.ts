import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackage, getRawHeader, listPackage } from "@electron/asar";
import { FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire } from "@electron/fuses";
import { rcedit } from "rcedit";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const EXTERNALS = [
  "sqlite-vec",
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-common",
  "sharp",
  "pdfjs-dist",
];

// ponytail: install-time or browser-only dependencies of the externals — never loaded by the app
export const SKIP_PACKAGES = new Set(["onnxruntime-web", "adm-zip", "global-agent"]);

// repo path → path next to the bundle (app/testimus.mjs)
export const PATH_MAP: [string, string][] = [
  ["package.json", "package.json"],
  ["templates", "templates"],
  ["tests/fixtures", "fixtures"],
  ["dist/ui", "ui"],
  [".models", "../models"],
];

export const LOCALES = ["en-US.pak", "fr.pak"];

export const FUSES = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
} as const;

export const LAYOUT = [
  "Testimus.exe",
  "resources/app.asar",
  "locales/en-US.pak",
  "locales/fr.pak",
  "icudtl.dat",
  "resources.pak",
  "v8_context_snapshot.bin",
  "ffmpeg.dll",
  "LICENSE",
  "node/node.exe",
  "app/testimus.mjs",
  "app/package.json",
  "app/ui/index.html",
  "app/templates/project",
  "app/templates/run-pages/index.html",
  "app/templates/reference/syntec/eval/behaviors.jsonl",
  "models",
  "testimus.cmd",
  "testimus.ico",
  "install.ps1",
  "README.txt",
];

export const NOT_IN_LAYOUT = ["electron.exe", "resources/default_app.asar"];

const URL_RE = /new URL\(\s*(["'`])((?:(?!\1)[^\\$]|\$(?!\{))*)(\$\{|\1)/g;

export function mapPath(repoRel: string): string | null {
  for (const [from, to] of PATH_MAP) {
    if (repoRel === from) return to;
    if (repoRel.startsWith(`${from}/`)) return `${to}${repoRel.slice(from.length)}`;
  }
  return null;
}

export function rewriteUrls(code: string, moduleFile: string, root = ROOT): string {
  return code.replace(URL_RE, (all, quote: string, rel: string, end: string, offset: number) => {
    if (!rel.startsWith(".")) return all;
    const after = code.slice(offset + all.length);
    const tail = end === quote ? /^\s*,\s*import\.meta\.url/ : /^[^`]*`\s*,\s*import\.meta\.url/;
    if (!tail.test(after)) return all;
    const abs = resolve(dirname(moduleFile), rel);
    let repoRel = relative(root, abs).split(sep).join("/");
    if (rel.endsWith("/") && repoRel) repoRel += "/";
    const mapped = mapPath(repoRel.replace(/\/$/, ""));
    if (mapped === null) return all;
    const out = mapped.startsWith("..") ? mapped : `./${mapped}`;
    return `new URL(${quote}${out}${repoRel.endsWith("/") ? "/" : ""}${end}`;
  });
}

export function parseShasums(text: string, major: number): { file: string; sha256: string; version: string } | null {
  const re = new RegExp(`^([0-9a-f]{64})\\s+(node-(v${major}\\.\\d+\\.\\d+)-win-x64\\.zip)$`, "m");
  const m = text.match(re);
  return m ? { sha256: m[1], file: m[2], version: m[3] } : null;
}

export function electronZip(version: string): string {
  return `electron-v${version}-win32-x64.zip`;
}

export function parseElectronShasums(text: string, version: string): string | null {
  const file = electronZip(version).replace(/\./g, "\\.");
  return text.match(new RegExp(`^([0-9a-f]{64}) [ *]?${file}\\r?$`, "m"))?.[1] ?? null;
}

export function pinnedElectron(root = ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  const want = pkg.devDependencies?.electron ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(want))
    throw new Error(`package.json must pin electron to an exact version (found "${want}").`);
  const installed = join(root, "node_modules", "electron", "package.json");
  const have = existsSync(installed)
    ? (JSON.parse(readFileSync(installed, "utf8")) as { version: string }).version
    : "";
  if (have !== want)
    throw new Error(`node_modules/electron is ${have || "missing"} but package.json pins ${want}: run npm install.`);
  return want;
}

export function keepElectronFile(rel: string): boolean {
  const r = rel.split(sep).join("/");
  if (r === "resources/default_app.asar") return false;
  if (r.startsWith("locales/")) return LOCALES.includes(r.slice("locales/".length));
  return true;
}

// ponytail: cmd.exe and PowerShell 5 read their scripts with CRLF line ends; the repository keeps LF, so the release
// writes them CRLF whatever checkout it is built from
export function windowsText(file: string): string {
  return readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n");
}

export function layoutProblems(out: string): string[] {
  const problems = LAYOUT.filter((f) => !existsSync(join(out, f))).map((f) => `missing ${f}`);
  for (const f of NOT_IN_LAYOUT) if (existsSync(join(out, f))) problems.push(`unexpected ${f}`);
  const locales = existsSync(join(out, "locales")) ? readdirSync(join(out, "locales")) : [];
  for (const f of locales) if (!LOCALES.includes(f)) problems.push(`unexpected locales/${f}`);
  return problems;
}

export async function readFuses(exe: string): Promise<Record<keyof typeof FUSES, boolean | null>> {
  const wire = (await getCurrentFuseWire(exe)) as unknown as Record<number, number>;
  const out = {} as Record<keyof typeof FUSES, boolean | null>;
  for (const name of Object.keys(FUSES) as (keyof typeof FUSES)[]) {
    const v = wire[FuseV1Options[name]];
    out[name] = v === 49 ? true : v === 48 ? false : null;
  }
  return out;
}

export function asarHeaderHash(asar: string): string {
  return createHash("sha256").update(getRawHeader(asar).headerString).digest("hex");
}

export function asarFiles(asar: string): string[] {
  return listPackage(asar, { isPack: false }).map((f) => f.replace(/\\/g, "/").replace(/^\//, ""));
}

const sha256Of = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export async function download(url: string, file: string, sha256: string, get: typeof fetch = fetch): Promise<string> {
  if (existsSync(file) && sha256Of(file) === sha256) return file;
  mkdirSync(dirname(file), { recursive: true });
  process.stderr.write(`Downloading ${basename(file)}…\n`);
  const res = await get(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  if (sha256Of(file) !== sha256) {
    rmSync(file, { force: true });
    throw new Error(`${basename(file)}: SHA-256 does not match SHASUMS256.txt`);
  }
  return file;
}

async function text(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

const ONLY: Record<string, string[]> = {
  "onnxruntime-node": ["package.json", "LICENSE", "dist/", "bin/napi-v6/win32/x64/"],
  "@huggingface/transformers": ["package.json", "LICENSE", "dist/transformers.node.mjs", "dist/transformers.node.cjs"],
};
const DROP: Record<string, RegExp> = {
  "pdfjs-dist": /^(web|types|image_decoders)(\/|$)/,
  sharp: /^(src|install)(\/|$)/,
};

export function keepFile(pkg: string, rel: string, isDir = false): boolean {
  const r = rel.split(sep).join("/");
  if (!isDir && (/\.(map|d\.ts|d\.mts|d\.cts|md|markdown)$/i.test(r) || /(^|\/)(CHANGELOG|README)[^/]*$/i.test(r)))
    return false;
  const only = ONLY[pkg];
  if (only)
    return only.some((k) =>
      k.endsWith("/")
        ? `${r}/`.startsWith(k) || (isDir && k.startsWith(`${r}/`))
        : r === k || (isDir && k.startsWith(`${r}/`)),
    );
  return !DROP[pkg]?.test(r);
}

export function dependencyClosure(nodeModules: string, roots: string[]): string[] {
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name) || SKIP_PACKAGES.has(name)) return;
    const pj = join(nodeModules, name, "package.json");
    if (!existsSync(pj)) return;
    seen.add(name);
    const p = JSON.parse(readFileSync(pj, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const d of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) walk(d);
  };
  for (const r of roots) walk(r);
  return [...seen].sort();
}

function copyPackage(nodeModules: string, name: string, dest: string): void {
  const src = join(nodeModules, name);
  cpSync(src, join(dest, name), {
    recursive: true,
    dereference: true,
    filter: (f) => f === src || keepFile(name, relative(src, f), statSync(f).isDirectory()),
  });
}

function run(cmd: string, args: string[], cwd = ROOT, input?: string): void {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
    input,
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status ?? r.error?.message})`);
}

function sizeOf(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    files++;
    bytes += statSync(join(e.parentPath, e.name)).size;
  }
  return { bytes, files };
}

export type ReleaseManifest = { version: string; built: string; files: number; bytes: number; notes: string };

// ponytail: written last, release.json is what install.ps1 checks a copy against (a release still being copied to the
// shared folder is refused) and where Testimus reads a release's notes; it does not count itself
export function writeManifest(out: string, version: string, notes: string, now = new Date()): ReleaseManifest {
  const file = join(out, "release.json");
  rmSync(file, { force: true });
  const s = sizeOf(out);
  const m = { version, built: now.toISOString(), files: s.files, bytes: s.bytes, notes: notes.trim() };
  writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

function driveRoot(letter: string): string {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-PSDrive -Name ${letter} -PSProvider FileSystem -ErrorAction SilentlyContinue).DisplayRoot`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return (r.stdout ?? "").trim();
}

// ponytail: a drive letter is this PC's name for a share (S: here may be T: elsewhere): a folder on a mapped drive is
// written as its \\server\share path, which every PC reads the same; a local or unmapped path stays as it is
export function uncPath(path: string, rootOf: (letter: string) => string = driveRoot): string {
  const m = /^([A-Za-z]):[\\/]/.exec(path);
  if (!m) return path;
  const root = rootOf(m[1].toUpperCase());
  return root.startsWith("\\\\") ? `${root.replace(/\\+$/, "")}\\${path.slice(3).replace(/\//g, "\\")}` : path;
}

// ponytail: a release reaches the shared folder under a hidden .partial name and is renamed once whole, so no PC ever
// sees half of it; a version already there is never replaced — a fix ships as a new version. The copy's release.json
// names the folder PCs look in for the next one (`channel`, this folder unless a move says another): a PC that
// installs it follows that, wherever the copy was taken from
// ponytail: a share (a NAS, an antivirus scanning what was just copied) can hold the fresh copy a moment: the rename is
// tried again for a few seconds on EPERM / EBUSY / EACCES before it fails
export function renameSoon(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  tries = 8,
  waitMs = 1500,
): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt >= tries || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

export function publishRelease(out: string, folder: string, channel = folder): string {
  if (!existsSync(join(out, "release.json")))
    throw new Error(`${out} has no release.json: build it with npm run release.`);
  mkdirSync(folder, { recursive: true });
  const target = join(folder, basename(out));
  if (existsSync(target))
    throw new Error(`${target} already exists: raise the version in package.json, rebuild, then publish.`);
  const partial = join(folder, `.${basename(out)}.partial`);
  rmSync(partial, { recursive: true, force: true });
  cpSync(out, partial, { recursive: true });
  const meta = join(partial, "release.json");
  writeFileSync(meta, `${JSON.stringify({ ...JSON.parse(readFileSync(meta, "utf8")), channel }, null, 2)}\n`);
  renameSoon(partial, target);
  return target;
}

export function releaseArgs(argv: string[]): {
  reuseUi: boolean;
  skipNode: boolean;
  notes: string;
  publish: boolean;
  publishTo: string;
  channel: string;
  publishOnly: boolean;
} {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
  };
  return {
    reuseUi: argv.includes("--reuse-ui"),
    skipNode: argv.includes("--skip-node"),
    notes: value("--notes"),
    publish: argv.includes("--publish") || argv.includes("--publish-only"),
    publishTo: value("--publish"),
    channel: value("--channel"),
    publishOnly: argv.includes("--publish-only"),
  };
}

// ponytail: the folder is the one given, else this PC's Settings › Updates folder — the one place to change when the
// team folder moves; nothing names it in the code
export function publishFolder(given: string, settingsFrom: string | undefined): string {
  const folder = given.trim() || settingsFrom?.trim() || "";
  if (!folder)
    throw new Error(
      'No folder to publish to: npm run release -- --publish "<shared folder>", or set it in Settings › Updates.',
    );
  return folder;
}

const TAR = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

function unzipOnce(zip: string, out: string, marker: string): string {
  if (existsSync(join(out, marker))) return out;
  const tmp = `${out}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  run(TAR, ["-xf", zip, "-C", tmp]);
  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  return out;
}

async function nodeRuntime(cache: string, major: number): Promise<string> {
  const base = `https://nodejs.org/dist/latest-v${major}.x/`;
  const want = parseShasums(await text(`${base}SHASUMS256.txt`), major);
  if (!want) throw new Error(`No node-v${major}.*-win-x64.zip in ${base}SHASUMS256.txt`);
  const zip = await download(`${base}${want.file}`, join(cache, want.file), want.sha256);
  const dir = want.file.replace(/\.zip$/, "");
  return join(unzipOnce(zip, join(cache, dir), join(dir, "node.exe")), dir);
}

async function electronRuntime(cache: string, version: string): Promise<string> {
  const base = `https://github.com/electron/electron/releases/download/v${version}/`;
  const sha = parseElectronShasums(await text(`${base}SHASUMS256.txt`), version);
  if (!sha) throw new Error(`No ${electronZip(version)} in ${base}SHASUMS256.txt`);
  const npmSums = join(ROOT, "node_modules", "electron", "checksums.json");
  const npmSha = existsSync(npmSums)
    ? (JSON.parse(readFileSync(npmSums, "utf8")) as Record<string, string>)[electronZip(version)]
    : undefined;
  if (npmSha && npmSha !== sha)
    throw new Error(`${electronZip(version)}: SHASUMS256.txt and node_modules/electron/checksums.json disagree`);
  const zip = await download(`${base}${electronZip(version)}`, join(cache, electronZip(version)), sha);
  return unzipOnce(zip, join(cache, electronZip(version).replace(/\.zip$/, "")), "electron.exe");
}

const INTEGRITY_PS = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TestimusRes {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool UpdateResource(IntPtr h, string type, string name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool EndUpdateResource(IntPtr h, bool discard);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr FindResource(IntPtr module, string name, string type);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr LoadResource(IntPtr module, IntPtr res);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr LockResource(IntPtr data);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint SizeofResource(IntPtr module, IntPtr res);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool FreeLibrary(IntPtr module);
  public static void Set(string file, string type, string name, byte[] data) {
    IntPtr h = BeginUpdateResource(file, false);
    if (h == IntPtr.Zero) throw new Win32Exception();
    if (!UpdateResource(h, type, name, 1033, data, (uint)data.Length)) { EndUpdateResource(h, true); throw new Win32Exception(); }
    if (!EndUpdateResource(h, false)) throw new Win32Exception();
  }
  public static string Get(string file, string type, string name) {
    IntPtr m = LoadLibraryEx(file, IntPtr.Zero, 0x22);
    if (m == IntPtr.Zero) throw new Win32Exception();
    try {
      IntPtr r = FindResource(m, name, type);
      if (r == IntPtr.Zero) return "";
      uint size = SizeofResource(m, r);
      byte[] bytes = new byte[size];
      Marshal.Copy(LockResource(LoadResource(m, r)), bytes, 0, (int)size);
      return System.Text.Encoding.UTF8.GetString(bytes);
    } finally { FreeLibrary(m); }
  }
}
"@
if ($env:TESTIMUS_RES_DATA) {
  [TestimusRes]::Set($env:TESTIMUS_RES_EXE, "INTEGRITY", "ELECTRONASAR", [IO.File]::ReadAllBytes($env:TESTIMUS_RES_DATA))
}
[Console]::Out.Write([TestimusRes]::Get($env:TESTIMUS_RES_EXE, "Integrity", "ElectronAsar"))
`;

function integrityResource(exe: string, write?: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "testimus-integrity-"));
  writeFileSync(join(tmp, "integrity.ps1"), INTEGRITY_PS);
  let data = "";
  if (write !== undefined) {
    data = join(tmp, "integrity.json");
    writeFileSync(data, write);
  }
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(tmp, "integrity.ps1")],
    { env: { ...process.env, TESTIMUS_RES_EXE: exe, TESTIMUS_RES_DATA: data }, encoding: "utf8", windowsHide: true },
  );
  rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`asar integrity resource of ${exe}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

export function asarIntegrityOf(exe: string): { file: string; alg: string; value: string }[] {
  const raw = integrityResource(exe);
  return raw ? (JSON.parse(raw) as { file: string; alg: string; value: string }[]) : [];
}

function embedAsarIntegrity(exe: string, asar: string): void {
  const want = JSON.stringify([{ file: "resources\\app.asar", alg: "SHA256", value: asarHeaderHash(asar) }]);
  if (integrityResource(exe, want) !== want) throw new Error("asar integrity resource not found after writing it");
}

export function shellPackageJson(version: string): string {
  return `${JSON.stringify({ name: "testimus", productName: "Testimus", version, private: true, main: "main.mjs" }, null, 2)}\n`;
}

async function desktopShell(out: string, cache: string, version: string): Promise<string> {
  const electron = pinnedElectron();
  const rt = await electronRuntime(cache, electron);
  cpSync(rt, out, {
    recursive: true,
    filter: (f) => f === rt || (basename(f) !== "electron.exe" && keepElectronFile(relative(rt, f))),
  });
  const exe = join(out, "Testimus.exe");
  cpSync(join(rt, "electron.exe"), exe);

  run(process.execPath, [join(ROOT, "scripts", "desktop.ts"), "--build-only"]);
  const stage = mkdtempSync(join(tmpdir(), "testimus-shell-"));
  cpSync(join(ROOT, "dist", "desktop"), stage, { recursive: true });
  writeFileSync(join(stage, "package.json"), shellPackageJson(version));
  const asar = join(out, "resources", "app.asar");
  mkdirSync(dirname(asar), { recursive: true });
  await createPackage(stage, asar);
  rmSync(stage, { recursive: true, force: true });

  const fileVersion = `${version.replace(/[^\d.].*$/, "")}.0`;
  await rcedit(exe, {
    icon: join(ROOT, "scripts", "testimus.ico"),
    "file-version": fileVersion,
    "product-version": fileVersion,
    "version-string": {
      FileDescription: "Testimus",
      ProductName: "Testimus",
      CompanyName: "Transurb",
      LegalCopyright: "Testimus",
      InternalName: "Testimus",
      OriginalFilename: "Testimus.exe",
    } as Record<string, string>,
  });
  embedAsarIntegrity(exe, asar);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: FUSES.RunAsNode,
    [FuseV1Options.EnableCookieEncryption]: FUSES.EnableCookieEncryption,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FUSES.EnableNodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableNodeCliInspectArguments]: FUSES.EnableNodeCliInspectArguments,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FUSES.EnableEmbeddedAsarIntegrityValidation,
    [FuseV1Options.OnlyLoadAppFromAsar]: FUSES.OnlyLoadAppFromAsar,
  });
  const got = await readFuses(exe);
  const wrong = (Object.keys(FUSES) as (keyof typeof FUSES)[]).filter((k) => got[k] !== FUSES[k]);
  if (wrong.length) throw new Error(`fuses not flipped in Testimus.exe: ${wrong.join(", ")}`);
  return electron;
}

function readme(version: string, node: string, electron: string, models: string): string {
  return [
    `Testimus ${version} — Windows x64`,
    "",
    "Install (per user, no admin rights):",
    "  powershell -ExecutionPolicy Bypass -File install.ps1",
    "",
    "It copies this folder to %LOCALAPPDATA%\\Testimus\\<version>, removes the 'downloaded from the internet'",
    "mark from the copy, puts `testimus` on your PATH and adds two Start-menu shortcuts:",
    "  Testimus            the desktop app (Testimus.exe)",
    "  Testimus (browser)  the same app in your default browser (testimus serve)",
    "then runs `testimus system setup` and `testimus system doctor`.",
    "Rerun a newer release to update, an older one to roll back.",
    "Updates: Testimus looks for newer releases in the shared folder this one was published to (or the folder",
    "set in Settings > Updates) and offers to install them; the two most recent versions are kept.",
    "Options: -NoDesktop (one shortcut, browser mode), -NoPath, -NoShortcut, -NoSetup, -NoPrompt, -Root <dir>,",
    "-Keep <n> (versions kept, default 2).",
    "",
    "Without installing: Testimus.exe (desktop app), testimus.cmd serve (browser mode), testimus.cmd help (CLI).",
    "",
    "Not signed: Testimus.exe is Electron renamed, without a code signature. Windows SmartScreen may warn",
    "('Windows protected your PC': More info, Run anyway), and a PC with AppLocker or WDAC rules may block it.",
    "If it is blocked, use the browser mode: the 'Testimus (browser)' shortcut or `testimus serve`. Same app,",
    "same project folders; only the window differs.",
    "",
    `Contents: Testimus.exe and Electron's files (desktop shell, Electron ${electron}; the shell is resources\\app.asar),`,
    `node/ (Node ${node}), app/ (Testimus bundled + UI + project template), models/ (${models}).`,
    "",
  ].join("\r\n");
}

export async function release(opts: { reuseUi: boolean; skipNode: boolean; notes?: string }): Promise<string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  const out = join(ROOT, "dist", `testimus-${pkg.version}-win-x64`);
  const app = join(out, "app");
  const nm = join(ROOT, "node_modules");
  const cache = join(ROOT, ".build", "cache");
  const t0 = Date.now();

  pinnedElectron();
  if (!opts.reuseUi) run(process.execPath, [join(nm, "vite", "bin", "vite.js"), "build"]);
  if (!existsSync(join(ROOT, "dist", "ui", "index.html")))
    throw new Error("dist/ui/index.html missing: vite build first.");

  rmSync(out, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });

  const { rolldown } = await import("rolldown");
  const bundle = await rolldown({
    input: join(ROOT, "src", "faces", "cli.ts"),
    platform: "node",
    external: (id) => EXTERNALS.some((e) => id === e || id.startsWith(`${e}/`)),
    plugins: [
      {
        name: "testimus-paths",
        transform(code, id) {
          if (id.includes("node_modules") || !/\.tsx?$/.test(id) || !code.includes("import.meta.url")) return null;
          const next = rewriteUrls(code, id);
          return next === code ? null : { code: next };
        },
      },
    ],
  });
  await bundle.write({ file: join(app, "testimus.mjs"), format: "esm", codeSplitting: false, minify: false });
  await bundle.close();

  writeFileSync(
    join(app, "package.json"),
    `${JSON.stringify({ name: "testimus", version: pkg.version, type: "module", private: true }, null, 2)}\n`,
  );
  cpSync(join(ROOT, "dist", "ui"), join(app, "ui"), { recursive: true });
  cpSync(join(ROOT, "templates"), join(app, "templates"), { recursive: true });
  cpSync(join(ROOT, "tests", "fixtures"), join(app, "fixtures"), { recursive: true });

  const packages = dependencyClosure(nm, EXTERNALS);
  for (const name of packages) copyPackage(nm, name, join(app, "node_modules"));

  let nodeVersion = process.version;
  if (!opts.skipNode) {
    const rt = await nodeRuntime(cache, 26);
    mkdirSync(join(out, "node"), { recursive: true });
    for (const f of ["node.exe", "LICENSE"]) cpSync(join(rt, f), join(out, "node", f));
    nodeVersion = rt.match(/node-(v[\d.]+)-/)?.[1] ?? nodeVersion;
  }

  const electron = await desktopShell(out, cache, pkg.version);

  const { SHIPPED } = await import("../src/core/lib/models-catalog.ts");
  const light = SHIPPED.packs.find((p) => p.id === "light")?.variants[0]?.embedding;
  const hfId = SHIPPED.entries.find((e) => e.id === light)?.source.hf?.repo;
  let models = "empty: the first index downloads its model";
  mkdirSync(join(out, "models"), { recursive: true });
  if (hfId && existsSync(join(ROOT, ".models", ...hfId.split("/"), "config.json"))) {
    cpSync(join(ROOT, ".models", ...hfId.split("/")), join(out, "models", ...hfId.split("/")), { recursive: true });
    models = `${light} = ${hfId}`;
  } else process.stderr.write(`note: .models/ has no ${light}: the release ships without models.\n`);

  for (const f of ["testimus.cmd", "install.ps1"]) writeFileSync(join(out, f), windowsText(join(ROOT, "scripts", f)));
  cpSync(join(ROOT, "scripts", "testimus.ico"), join(out, "testimus.ico"));
  writeFileSync(join(out, "README.txt"), readme(pkg.version, nodeVersion, electron, models));

  const problems = layoutProblems(out).filter((p) => !(opts.skipNode && p === "missing node/node.exe"));
  if (problems.length) throw new Error(`release layout: ${problems.join("; ")}`);

  const s = sizeOf(out);
  const part = (d: string) => (existsSync(join(out, d)) ? sizeOf(join(out, d)).bytes / 1024 ** 2 : 0);
  const shellMb = (s.bytes / 1024 ** 2 - part("node") - part("app") - part("models")).toFixed(0);
  process.stdout.write(
    `${out}\n${s.files} files, ${(s.bytes / 1024 ** 2).toFixed(0)} MB (models ${part("models").toFixed(0)} MB, ` +
      `node ${part("node").toFixed(0)} MB, app ${part("app").toFixed(0)} MB, Electron shell ${shellMb} MB), ` +
      `Electron ${electron}, externals: ${packages.join(", ")}; ${((Date.now() - t0) / 1000).toFixed(0)} s\n`,
  );
  writeManifest(out, pkg.version, opts.notes ?? "");
  return out;
}

// ponytail: npm run release [-- --notes "what is new"] [-- --publish [<shared folder>]] [-- --channel <new folder>];
// --publish alone uses Settings › Updates; --publish-only publishes the release already built for package.json's
// version; --channel (a move) sends the PCs that install this release to another folder for the next one
if (import.meta.main) {
  const args = releaseArgs(process.argv.slice(2));
  (async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    let folder = "";
    if (args.publish) {
      const { readSettings } = await import("../src/core/lib/project.ts");
      folder = publishFolder(args.publishTo, readSettings().updates?.from);
    }
    const built = join(ROOT, "dist", `testimus-${pkg.version}-win-x64`);
    const out = args.publishOnly ? built : await release(args);
    if (args.publishOnly && args.notes) writeManifest(out, pkg.version, args.notes);
    if (!folder) return;
    const channel = uncPath(args.channel || folder);
    process.stdout.write(`published to ${publishRelease(out, folder, channel)}; installs look in ${channel}\n`);
  })().catch((e) => {
    process.stderr.write(`release failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
