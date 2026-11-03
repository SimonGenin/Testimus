# Testimus — Desktop app (Electron shell around `testimus serve`)

Status: **built (E1–E4), 2026-11-02 — see SPEC.md §1, §2, §13 « Desktop shell », §14, §15. E0 (signing on a tester's
PC) is open; E5 is not built.** What follows is kept as the design record; SPEC.md is the contract. It extended SPEC.md §1, §2, §13, §14 and
§15 and answers the ROADMAP « Later » line « Desktop shell (Tauri or Electron) around `testimus serve` ».
When a part is built, its behavior moves into SPEC.md in the same change and leaves this file; SPEC.md
stays the contract. The runtime facts below were tried on the dev PC on 2026-11-02 (§13).

Marks used below: ✅ verified in the code or on the dev PC on 2026-11-02 · ⚠️ hypothesis, secondary
source or to be checked when built.

## 0. Why this change

Today a tester starts Testimus from the Start menu: a console window runs `testimus serve` and the
default browser opens `http://localhost:4317`. It works, but:

1. **It does not feel like an app.** A console to leave open, a browser tab among thirty, a port that
   may already be taken, a tab that keeps polling after the console was closed.
2. **The browser cannot do what the work needs.** No folder picker (a project folder is typed as a
   path in [ProjectStep.tsx](src/ui/screens/setup/ProjectStep.tsx)); a 900-page `.docx` is read into
   base64 and posted to `docs.add` instead of passing its path; no taskbar progress for a 20-minute
   `gen.tests` job, no notification when it ends, no « Show in Explorer ».
3. **Closing is unsafe.** Closing the console kills the core mid-job; the `claude -p` children it
   spawned may keep running.

Goals:

- **G1** — One window, one icon in the Start menu and the taskbar; double-click, the app is there.
- **G2** — Native affordances where they help the work: folder and file pickers that give real paths,
  taskbar progress, a notification at the end of a job, « Show in Explorer », a safe quit.
- **G3** — **Nothing changes below the HTTP face.** Same core, same registry, same three faces, same
  UI served by the same `serve`, same security guard. The browser mode keeps working; the desktop app
  is a shell, not a fourth face.
- **G4** — Same install rules as SPEC §14: per user, no admin, no compiler, no Python; update by
  rerunning a newer release, rollback by an older one.

Not goals: moving domain code into Electron's main process; an IPC API next to `/api`; macOS or Linux
builds; start at login; background jobs with no window (a tray app); a UI rewrite.

## 1. Where we stand (baseline, verified)

| Piece | Today ✅ |
|---|---|
| Start | Start-menu shortcut → `testimus.cmd serve` ([install.ps1:72](scripts/install.ps1:72)) → [`serve()`](src/faces/http.ts:213) listens on `127.0.0.1:4317` (or `--port`, `TESTIMUS_PORT`), then `cmd /c start <url>` opens the default browser unless `--no-open`. |
| Guard | [`guard()`](src/faces/http.ts:94): local `Host` and `Origin` on `state.port`, `Sec-Fetch-Site` not cross-site, `SameSite=Strict` session cookie set when `/` is served, JSON bodies. Token kept in `%APPDATA%\Testimus\session.key`. |
| Runtime | Portable Node 26 (`node/node.exe`, 100 MB) runs the Rolldown bundle `app/testimus.mjs`; externals in `app/node_modules` (sqlite-vec, onnxruntime-node, transformers.js, sharp, pdfjs-dist). `package.json` asks `node >= 24.14`. |
| Claude / MCP | The core spawns `claude -p`; `.mcp.json` runs `cmd /c <abs>\testimus.cmd mcp` (SPEC §11). |
| Files from the UI | `<input type="file">` in Documents, Import, step images; drop on Documents; `docs.add` takes `{ path }` or `{ name, dataBase64 }` (SPEC §12). Project folders are typed as text. |
| Links | `target="_blank"` to Atlassian's token page ([AccessStep.tsx:120](src/ui/screens/setup/AccessStep.tsx:120)); `window.open` of a step image under `/files/` ([ReviewScreen.tsx:459](src/ui/screens/review/ReviewScreen.tsx:459)). |
| UI state | Theme, step layout, last project in `localStorage` ([theme.ts](src/ui/lib/theme.ts)). |
| Dev | `vite` on 4318 proxies `/api` to 4317 ([vite.config.ts](vite.config.ts)). |

## 2. Principles

- **D1 — The shell is a window around the HTTP face.** The main process starts the core, opens a
  window on its URL, and offers a few native services. It never imports `src/core/`. Anything that reads
  or changes a project goes through `/api`, exactly as in the browser.
- **D2 — The bridge carries presentation only.** A native picker returns a path; the UI then calls the
  command (`project.open`, `docs.add { path }`). Progress, notifications and « Show in Explorer » are
  side effects on the desktop, not on the project. A capability that only the bridge can reach is a bug
  (SPEC §2: « A feature that exists only in the UI is a bug »).
- **D3 — The browser mode stays first-class.** Every screen works without the bridge (feature
  detection, same fallback as today). Playwright e2e keeps running against the browser; the desktop
  adds its own smoke tests.
- **D4 — Locked down by default.** The window loads only its own origin, has no Node, runs sandboxed,
  and grants no permission (§6).
- **D5 — The core outlives nothing.** When the shell quits or dies, the core cancels its jobs, stops its
  `claude -p` children and exits; no orphan keeps the index or a Claude run alive.

## 3. Process layout

```
Testimus.exe  (Electron main — src/desktop/main.ts, bundled)
  ├─ spawns  node\node.exe app\testimus.mjs serve --port 0 --no-open --ready-json --exit-with-stdin
  │            └─ stdout line {"ready":true,"url":"http://127.0.0.1:<port>/","pid":…}
  │            └─ spawns claude -p … (unchanged), which calls back through testimus.cmd mcp (unchanged)
  ├─ BrowserWindow → http://127.0.0.1:<port>/   (the same UI; the cookie guard applies as in a browser)
  │     └─ preload.ts → window.testimusDesktop (§5)
  └─ single-instance lock, window state, quit policy, logs
```

### 3.1 Runtime choice

Two ways are possible; **B is proposed**.

| | A — Electron's own Node runs the core | B — the shipped Node 26 runs the core ✅ proposed |
|---|---|---|
| How | `Testimus.exe` with `ELECTRON_RUN_AS_NODE=1` runs `testimus.mjs` (core, CLI, MCP) | Electron is only the shell; `node\node.exe` runs the core, CLI and MCP as today |
| Node version | Electron 45.2.1 ships **Node 24.22.1** ✅; follows Electron's schedule | Node 26 LTS as SPEC §1 decides |
| Works today | ✅ 449/449 unit tests, CLI, `serve --mock`, sqlite-vec, onnxruntime, bge-m3 embedding (§13) | ✅ it is the current release |
| Size | − 100 MB (no `node.exe`) | + 100 MB on a release of ≈ 1.1 GB |
| Hardening | The `RunAsNode` fuse must stay **on**: `Testimus.exe` doubles as a general Node | All fuses off (§6.3); the shell can only be the shell |
| Coupling | Core, CLI, MCP and shell upgrade together, at Electron's pace | The shell can be updated, swapped (Tauri) or dropped without touching the core |

B keeps SPEC §1 and §14 as they are, keeps G3 literal and costs 100 MB. A stays a measured fallback
(§13) if size or a single runtime becomes the priority; switching later is a release-script change.

### 3.2 Changes to `serve` (core, small)

- `--port 0`: the OS picks a free port; `state.port` is set from `server.address().port` **after**
  `listen`, so the guard checks the real port. The browser mode keeps 4317 by default.
- `--ready-json`: once listening, one JSON line on stdout `{ ready, url, pid, version }`; errors before
  that go to stderr and exit non-zero.
- `--exit-with-stdin`: when stdin closes (the parent died or quit), the core stops accepting requests,
  cancels running jobs (each logged `cancelled` in `.testimus/jobs/<id>.jsonl`), stops the process tree
  of every `claude -p` it started (`taskkill /T /F /PID` on Windows), then exits. Runs already recorded
  stay revertable (SPEC §11).
- `TESTIMUS_SHELL=desktop/<version>` (set by the shell) shows in `system.version` and as a `doctor` info
  row, so a support question says which face the user ran.

These are CLI flags of `serve`, not commands: the registry is unchanged.

### 3.3 Start, crash, quit

- The window opens at once on a local splash page (packed with the shell) and switches to the core URL
  on the ready line. No ready line within 30 s ⚠️ (to measure: cold start on a laptop with antivirus),
  or the core exits: an error page with the last 40 lines of the core log, **Restart** and **Open the
  log folder**.
- Core and shell logs: `%LOCALAPPDATA%\Testimus\logs\desktop-<date>.log` (kept 14 days).
- **Single instance**: a second launch focuses the existing window; a folder passed on the command line
  (`Testimus.exe D:\proj`) is opened through `project.open` by the UI (bridge event `openProject`).
- **Quit**: closing the window with no job running quits. With jobs running (from `jobs.list`), a dialog
  names them: « Generate tests — 12/40 » → **Cancel and quit** / **Keep working**. Quit closes the
  core's stdin (§3.2) and waits up to 10 s ⚠️ before killing its tree.
- A `serve` started by hand (CLI, browser) may run beside the desktop app on another port. Two cores on
  one project folder is the same situation as today (SPEC §16, locking) and is not solved here.

## 4. Window

- One main window; size, position and maximized state kept in `%APPDATA%\Testimus\window.json`; clamped
  to a visible display on start (a laptop undocked from its second screen).
- Title « Testimus — <project name> », set by the UI through `document.title` (not set today ✅).
- Menu bar hidden; the app's own shell (rail, Ctrl+K palette) is the menu. Standard edit shortcuts
  (Ctrl+C/V/X/Z/A) keep working through Electron's role menu, hidden ⚠️.
- Zoom Ctrl+=/−/0 kept, remembered with the window state (laptops at 150 % need it, SPEC §13).
- `localStorage` lives in the shell's own profile (`%APPDATA%\Testimus\desktop\`): theme and last
  project do not carry over from the browser mode, which is acceptable ⚠️ (or: read them once from the
  server's settings — decide when built).

## 5. Bridge (`window.testimusDesktop`)

Exposed by `preload.ts` through `contextBridge`, only on the core's origin. Every call validates its
arguments in the main process; nothing passes raw `ipcRenderer` to the page.

| Call | Does | Used by |
|---|---|---|
| `version()` | `{ shell, electron, chrome }` | About, doctor info |
| `pickFolder({ title, defaultPath? })` | native folder dialog → absolute path or null | First launch › Project, project menu (« Browse… » beside the text field) |
| `pickFiles({ title, filters, multiple })` | native file dialog → absolute paths | Documents « Add », Settings › Claude executable |
| `pathOf(file)` | `webUtils.getPathForFile` for a `File` from an input or a drop → path or "" | Documents drop and input: `docs.add { path }` instead of base64 |
| `reveal(path)` | `shell.showItemInFolder`, only for a path inside a known project or the data folders | « Show in Explorer » on a project, a document, a test |
| `openExternal(url)` | default browser, `https:` only | Atlassian token page, Claude docs |
| `setProgress(fraction \| null)` | taskbar progress of the window | jobs (Generate, Index, Check, Pull) |
| `notify({ title, body })` | Windows notification, only when the window is not focused; click focuses it | end of a job, a failed Claude run |
| `onOpenProject(cb)` | path from a second launch | §3.3 |

The UI reads it once in `src/ui/lib/desktop.ts`; absent → current behavior (text field, base64 upload,
no progress). `pathOf` + `docs.add { path }` also removes the base64 copy of large documents, the one
measurable gain for the core ⚠️ (memory peak on a 900-page docx to measure).

## 6. Security

### 6.1 Window

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`,
`allowRunningInsecureContent: false`, no `webviewTag`, `spellcheck` off. Content loaded: the core
origin `http://127.0.0.1:<port>` and the shell's own splash and error pages; nothing else.

### 6.2 Navigation and permissions

- `will-navigate` / `will-redirect`: anything off the core origin is cancelled.
- `setWindowOpenHandler`: an `https:` URL → `openExternal` (default browser); a same-origin
  `/files/…` URL → a child window in the same session (the cookie is needed), sandboxed, no bridge;
  anything else denied.
- `setPermissionRequestHandler` and `setPermissionCheckHandler`: everything denied except
  `clipboard-sanitized-write` (Connect Claude copies a command, [ConnectClaude.tsx](src/ui/components/claude/ConnectClaude.tsx)).
  Pasting images into a step reads `clipboardData` in the `paste` event, which needs no permission ⚠️
  (to confirm in the window).
- Downloads (`will-download`) denied: Testimus writes files through commands, not the browser.
- The UI's `index.html` gets a Content-Security-Policy (`default-src 'self'; img-src 'self' data:;
  style-src 'self' 'unsafe-inline'; connect-src 'self'`) served by the core in both modes ⚠️ (check
  the inline theme script in [index.html](src/ui/index.html) — it needs a hash or to move to a file).
- The cookie guard of SPEC §2 is unchanged and still the real protection: the bridge gives the page no
  way around it.

### 6.3 Fuses and packaging

With runtime B, flipped at release time with `@electron/fuses`: `RunAsNode` off,
`EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off,
`EnableCookieEncryption` on, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on.
The **shell** (main, preload, splash, error page — a few files) is packed in `resources/app.asar`; the
**core** stays plain files next to it (`node/`, `app/`, `models/`), as today: asar would gain nothing
for one bundled file and complicates native modules and models.

### 6.4 Signing ⚠️

Nothing in the release is signed today (`node.exe` keeps the OpenJS signature). Renaming and
re-iconing `electron.exe` gives an unsigned `Testimus.exe`. On a PC with SmartScreen, AppLocker or WDAC
rules, an unsigned exe in `%LOCALAPPDATA%` may be warned about or blocked. To check on a tester's PC
**before E2 starts** (§12, question 1); if blocked, a Transurb code-signing certificate is needed, or the
desktop app is shelved and the browser mode stays (D3 makes that free). `install.ps1` runs
`Unblock-File` on the copied release (per user, no admin) so a release copied from Teams does not carry
the Mark of the Web ⚠️.

## 7. Release and install (extends SPEC §14)

- `npm run release` keeps building `testimus-<version>-win-x64/` and adds the shell:
  - Electron's Windows x64 zip at a **pinned version**, downloaded once into `.build/cache/` and checked
    against Electron's `SHASUMS256.txt` (same as Node today, [release.ts:127](scripts/release.ts:127));
    downloaded with Node's `fetch`, never `curl.exe` (SPEC-RAG F17).
  - `electron.exe` renamed `Testimus.exe`; icon (`scripts/testimus.ico`) and version info set with
    `rcedit` on the build PC only; fuses flipped (§6.3); locales trimmed to `en-US` and `fr` (− ≈ 45 MB of
    49 ✅ measured on the folder).
  - `src/desktop/` bundled by Rolldown into `resources/app.asar` (`main.mjs`, `preload.cjs`, `pages/`).
- Layout: `Testimus.exe` and Electron's files at the root, `resources/app.asar`, then `node/`, `app/`,
  `models/`, `testimus.cmd`, `install.ps1`, `README.txt` as today. Size: + ≈ 310 MB unpacked
  (Electron 45 is 357 MB ✅ before trimming).
- No electron-builder or Forge (26.18.0 and 8.0.1 on npm ✅): both want to own the layout, the installer
  and the update channel that SPEC §14 already defines. Reopen if E5 needs an installer.
- `install.ps1`: the Start-menu shortcut runs `Testimus.exe` instead of `testimus.cmd serve`; a second
  shortcut « Testimus (browser) » keeps the old way. `testimus.cmd` on PATH is unchanged (CLI and MCP).
  `-NoDesktop` keeps the old single shortcut. Rerun = update, older = rollback, as today.
- Proof (SPEC §14): on a clean user account, the shortcut opens the window; First launch, project
  init, index a sample docx; one real `claude -p` run from the window (the mock proves nothing about
  spawning Claude from a GUI process); quit with a job running and check that no `node.exe` or
  `claude.exe` is left.

## 8. Updates (optional, E5)

Without an HTTPS host for releases (SPEC §16: Teams/SharePoint or a share, undecided), no auto-update
framework fits. Proposed: `settings.updates.from` = a folder (the team share) holding `latest.json`
`{ version, folder, notes }`. At start the shell reads it (a file read, no network service), and when it
is newer shows « Testimus 0.3.0 is available » → **Install** runs that release's `install.ps1 -NoPrompt`
and restarts. Reopen with electron-updater if the team publishes over HTTPS.

## 9. Proxy

Chromium in the shell follows the Windows proxy settings (WinINet, PAC) ⚠️; the core follows
`HTTPS_PROXY` (SPEC §14). When `HTTPS_PROXY` is not set, the shell may resolve the proxy for
`https://transurb.atlassian.net` and `https://huggingface.co` with `session.resolveProxy` and pass it to
the core as `HTTPS_PROXY` (with `NODE_USE_ENV_PROXY=1`); `doctor` shows « proxy: from Windows settings ».
⚠️ A PAC that answers differently per host cannot be reduced to one variable; to check on the Transurb
network before adopting.

## 10. Development and tests

- `src/desktop/`: `main.ts` (lifecycle, single instance, quit), `core.ts` (spawn, ready line, stdin,
  restart), `window.ts` (state, navigation and permission policy), `bridge.ts` (IPC handlers and their
  checks), `preload.ts`, `pages/` (splash, error). One area per file, ponytail style, no comments but
  `// ponytail:`.
- `npm run desktop`: Rolldown builds `src/desktop/` to `dist/desktop/`, then Electron starts it; the shell
  spawns `node src/faces/cli.ts serve --port 0 …` with the developer's Node 26. `--ui-dev` loads the Vite
  server (4318) instead, its `/api` proxy pointed at the spawned port ⚠️ (the proxy target becomes an
  env variable). `--mock` passes through to `serve`.
- Electron is a devDependency pinned to one version; the release downloads the same version (§7).
- Unit tests (`tests/unit/desktop/`): URL and navigation policy, bridge argument checks, ready-line
  parsing, window-state clamping, quit decision from `jobs.list` — pure functions, Electron faked.
- E2e (`tests/e2e/desktop/`): Playwright's `_electron.launch` on the built shell with `--mock`: the
  window reaches the Documents screen, an external link does not navigate, `pickFolder` stubbed in the
  main process opens a project, quit with a running mock job shows the dialog and leaves no process.
  The browser e2e suite is unchanged.
- §15 for a desktop change: the bar of SPEC §15 + the desktop e2e + the clean-account proof of §7 for
  packaging.

## 11. Phases

Each ends on SPEC §15 and moves its behavior into SPEC.md.

| Phase | Content |
|---|---|
| E0 | Check signing and execution policy on a tester's PC with an unsigned renamed `electron.exe` (§6.4). **Before any code.** **Open: needs a tester's PC; built unsigned, browser mode as fallback (decision 1).** |
| E1 | `serve --port 0 --ready-json --exit-with-stdin`, job cancel and Claude tree kill on shutdown, `TESTIMUS_SHELL`. Useful to the browser mode too (no port clash). **Built — SPEC §2, §11.** |
| E2 | Shell: main, core spawn, splash and error page, window state, navigation and permission policy, single instance, quit with jobs; `npm run desktop`; unit + Electron e2e. **Built — SPEC §13 « Desktop shell ».** |
| E3 | Bridge and UI: Browse folder, `pathOf` → `docs.add { path }`, Import and claude.exe pickers, taskbar progress, notifications, Show in Explorer. **Built — SPEC §13 « Desktop shell ».** |
| E4 | Release: pinned Electron + SHA-256, rename, icon, fuses, asar, locales; `install.ps1` shortcuts, `Unblock-File`; clean-account proof. **Built — SPEC §14, §15.** |
| E5 (optional) | Updates from the team folder (§8); proxy from Windows settings (§9); Explorer « Open in Testimus » on a folder (HKCU, no admin). **Not built this round (decision 7).** |

E1 does not depend on E0 and can start now. E3 needs E2. E4 needs E0's answer.

## 12. Open questions

1. Signing: does an unsigned `Testimus.exe` run on the testers' PCs (SmartScreen, AppLocker, WDAC,
   Defender)? If not, can Transurb IT sign it, or does the desktop app wait?
2. Runtime A or B (§3.1): 100 MB and two runtimes, against Node 24 for everything at Electron's pace and
   the `RunAsNode` fuse left on.
3. Electron supports its last three majors (≈ 8-week cycle ⚠️): a release at least every 6 months to stay
   on a patched Chromium. Who builds it (SPEC §16)?
4. Keep the « Testimus (browser) » shortcut for everyone, or only for developers?
5. Closing the window while a job runs: always ask (proposed), or offer to keep running in the
   notification area (a tray app is a non-goal today)?
6. UI preferences in `localStorage` (§4): accept the split between browser and desktop, or move theme and
   step layout to `settings.json` through `system.saveSettings`?
7. Updates (§8): is a shared folder reachable from every tester's PC, or must it wait for an HTTPS host?

## 13. Tried on the dev PC (2026-11-02)

Smoke tests, not a benchmark. Electron 45.2.1 from npm into a scratch folder; commands run from the
Testimus checkout with `ELECTRON_RUN_AS_NODE=1 electron.exe …` (runtime A of §3.1).

| What | Result |
|---|---|
| Latest Electron majors (`releases.electronjs.org/releases.json`) | 45.2.1 (Node 24.22.1, Chrome 156, 2026-10-30), 44.10.1 and 43.8.6 (Node 24.22.1), 42.11.18 (Node 24.19.0) ✅ |
| TypeScript run as is (type stripping), `node:sqlite` with `allowExtension`, FTS5 | ✅ |
| `sqlite-vec` loaded into `node:sqlite` | `v0.1.9` ✅ |
| `onnxruntime-node` (N-API, no rebuild) | loads ✅ |
| transformers.js 4, bge-m3 q8 from `.models/`, CPU | 1 × 1024 vector, 1.36 s including model load ✅ |
| `vitest run` (50 files) | 449 / 449 passed, 6.8 s ✅ |
| `cli.ts system version --json` | `"node": "v24.22.1"` ✅ |
| `serve --mock --port 4399 --no-open` | `/api/system/version` answers; `GET /` 200 with the `testimus_session` cookie ✅ |
| Sizes | `electron.exe` 250 MB, `dist/` 357 MB, `locales/` 49 MB; Node 26 `node.exe` 100 MB ✅ |

Not tried yet: the UI inside a `BrowserWindow`, the fuses, a renamed and re-iconed exe on another PC,
DirectML (SPEC-RAG F8) under Electron's Node.

## 14. Sources outside the code

- Electron releases and bundled versions: https://releases.electronjs.org/releases.json
- Security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- `webUtils.getPathForFile`: https://www.electronjs.org/docs/latest/api/web-utils
- Single instance: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata
- Release timelines and supported versions: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- Playwright Electron: https://playwright.dev/docs/api/class-electron
