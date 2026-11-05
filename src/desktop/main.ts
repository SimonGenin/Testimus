import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, screen, session, shell } from "electron";
import { registerBridge } from "./bridge.ts";
import { CHANNEL } from "./bridge-types.ts";
import {
  api,
  type Core,
  cancelJobs,
  coreEnv,
  coreLaunch,
  currentExe,
  findNode,
  killTree,
  quitDecision,
  type Ready,
  runningJobs,
  sessionCookie,
  shellArgs,
  startCore,
  startUiDev,
  stopCore,
  UI_DEV_PORT,
  waitHttp,
} from "./core.ts";
import { clearTail, dataDir, lastLines, localDir, log, logDir, pruneLogs } from "./log.ts";
import {
  clampState,
  hiddenMenu,
  LOCKED_PREFERENCES,
  lockContents,
  lockSession,
  MIN_SIZE,
  readState,
  writeState,
} from "./window.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, "pages");
const ERROR_PAGE = join(PAGES, "error.html");
const LOGO = join(PAGES, "logo.png");
const APP_ID = "Testimus";
const SHELL_VERSION = __VERSION__;
const packaged = app.isPackaged;
const exeDir = dirname(process.execPath);
const repo = resolve(HERE, "..", "..");
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const args = shellArgs(process.argv, process.cwd(), isDir);

let win: BrowserWindow | null = null;
let core: Core | null = null;
let ready: Ready | null = null;
let origin: string | null = null;
let lastPort: number | undefined;
let uiDev: { pid?: number } | null = null;
let errorMessage = "";
let pendingFolder: string | null = args.folder;
let zoom = 1;
let closing = false;
let allowClose = false;
let stopped: Promise<void> | null = null;
let shutDown = false;
let relaunching = false;

app.setPath("userData", join(dataDir(), "desktop"));
app.setAppUserModelId(APP_ID);

function focus(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function sendFolder(): void {
  if (!pendingFolder || !win || !origin || !win.webContents.getURL().startsWith(origin)) return;
  log("shell", `open project ${pendingFolder}`);
  win.webContents.send(CHANNEL.openProject, pendingFolder);
  pendingFolder = null;
}

async function windowCookie(): Promise<string> {
  if (!ready) return "";
  const [c] = await session.defaultSession.cookies.get({ url: ready.origin, name: "testimus_session" }).catch(() => []);
  return c ? `testimus_session=${c.value}` : await sessionCookie(ready.origin).catch(() => "");
}

function showError(message: string): void {
  errorMessage = message;
  origin = null;
  log("shell", `error page: ${message}`);
  win?.setProgressBar(-1);
  win?.loadFile(ERROR_PAGE).catch(() => {});
}

function coreAlive(c: Core | null): c is Core {
  return !!c && c.child.exitCode === null && c.child.signalCode === null;
}

async function launchCore(): Promise<void> {
  if (!win) return;
  clearTail();
  ready = null;
  origin = null;
  await win.loadFile(join(PAGES, "splash.html")).catch(() => {});
  lastPort ??= readState().port;
  let c: Core;
  try {
    const launch = coreLaunch({
      packaged,
      exeDir,
      repo,
      node: findNode(process.env),
      mock: args.mock,
      port: args.mock ? undefined : lastPort,
      project: pendingFolder,
    });
    c = startCore(launch, coreEnv(process.env, { shellVersion: SHELL_VERSION, packaged, exeDir }));
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return;
  }
  core = c;
  let r: Ready;
  try {
    r = await c.ready;
  } catch (e) {
    if (c === core && !closing) showError(e instanceof Error ? e.message : String(e));
    return;
  }
  log("shell", `core ready on ${r.url} (pid ${r.pid ?? c.child.pid}, version ${r.version ?? "?"})`);
  c.exited.then((code) => {
    if (c === core && !closing) showError(`The core stopped (exit code ${code ?? "none"}).`);
  });
  ready = r;
  lastPort = Number(new URL(r.origin).port) || lastPort;
  let url = r.url;
  if (args.uiDev) {
    const node = findNode(process.env);
    if (!node) return showError("Node was not found on the PATH: --ui-dev needs it to run Vite.");
    uiDev = startUiDev(node, repo, r.origin);
    const devUrl = `http://localhost:${UI_DEV_PORT}/`;
    if (!(await waitHttp(devUrl, 30_000))) return showError(`Vite did not answer on ${devUrl}.`);
    const cookie = await sessionCookie(r.origin).catch(() => "");
    if (cookie)
      await session.defaultSession.cookies.set({
        url: devUrl,
        name: "testimus_session",
        value: cookie.split("=")[1] ?? "",
        path: "/",
        httpOnly: true,
        sameSite: "strict",
      });
    url = devUrl;
  }
  origin = new URL(url).origin;
  if (!win || win.isDestroyed()) return;
  await win.loadURL(url).catch((e) => log("shell", `load ${url}: ${e instanceof Error ? e.message : e}`));
  if (!win || win.isDestroyed()) return;
  win.webContents.setZoomFactor(zoom);
  sendFolder();
}

async function restart(): Promise<void> {
  const old = core;
  core = null;
  if (coreAlive(old)) await stopCore(old, 3000);
  if (uiDev?.pid) killTree(uiDev.pid);
  uiDev = null;
  await launchCore();
}

function saveState(): void {
  if (!win || win.isDestroyed()) return;
  if (origin && win.webContents.getURL().startsWith(origin)) zoom = win.webContents.getZoomFactor();
  writeState({ ...win.getNormalBounds(), maximized: win.isMaximized(), zoom, ...(lastPort ? { port: lastPort } : {}) });
}

function shutdown(): Promise<void> {
  if (!stopped) {
    closing = true;
    stopped = (async () => {
      if (uiDev?.pid) killTree(uiDev.pid);
      if (coreAlive(core)) await stopCore(core);
      shutDown = true;
      log("shell", "stopped");
    })();
  }
  return stopped;
}

async function requestQuit(): Promise<void> {
  if (closing || !win) return;
  closing = true;
  try {
    if (ready && coreAlive(core)) {
      const cookie = await windowCookie();
      const jobs = await runningJobs(ready.origin, cookie, core.child.pid).catch(() => []);
      const d = quitDecision(jobs);
      if (d.ask) {
        log("shell", `quit asked with ${jobs.length} running job(s)`);
        const r = await dialog.showMessageBox(win, {
          type: "warning",
          title: "Testimus",
          message: d.message,
          detail: d.detail,
          buttons: ["Cancel and quit", "Keep working"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (r.response !== 0) {
          log("shell", "quit: keep working");
          closing = false;
          relaunching = false;
          return;
        }
        log("shell", "quit: cancel and quit");
        await cancelJobs(ready.origin, cookie, jobs);
      }
    }
  } catch (e) {
    log("shell", `quit check failed: ${e instanceof Error ? e.message : e}`);
  }
  saveState();
  win.hide();
  await shutdown();
  if (relaunching) {
    const exe = packaged ? currentExe(exeDir, process.execPath) : process.execPath;
    log("shell", `relaunch: ${exe}`);
    app.relaunch(packaged ? { execPath: exe, args: [] } : undefined);
  }
  allowClose = true;
  win.close();
}

function createWindow(): BrowserWindow {
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  const state = clampState(readState(), displays, screen.getPrimaryDisplay().workArea);
  zoom = state.zoom;
  const w = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: "Testimus",
    icon: LOGO,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e0e10" : "#f7f7f8",
    autoHideMenuBar: false,
    webPreferences: { ...LOCKED_PREFERENCES, preload: join(HERE, "preload.cjs") },
  });
  w.setMenuBarVisibility(false);
  // ponytail: Windows takes the taskbar button, pin and toast identity from these, not from the window icon; unpackaged
  // they would be electron.exe's
  if (process.platform === "win32")
    w.setAppDetails({
      appId: APP_ID,
      appIconPath: packaged ? process.execPath : join(PAGES, "testimus.ico"),
      relaunchCommand: packaged ? `"${process.execPath}"` : `"${process.execPath}" "${join(HERE, "main.mjs")}"`,
      relaunchDisplayName: "Testimus",
    });
  if (state.maximized) w.maximize();
  w.once("ready-to-show", () => w.show());
  w.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    requestQuit();
  });
  w.on("session-end", () => {
    allowClose = true;
    saveState();
    shutdown();
  });
  w.webContents.on("did-finish-load", () => sendFolder());
  w.on("closed", () => {
    win = null;
  });
  return w;
}

function knownRoots(): Promise<string[]> {
  const roots = [dataDir(), localDir(), join(homedir(), ".atlassian")];
  if (!ready) return Promise.resolve(roots);
  const from = ready.origin;
  return windowCookie()
    .then((cookie) => api<{ last: string; projects: { dir: string }[] }>(from, cookie, "project.list", {}))
    .then((r) => [...roots, r.last, ...r.projects.map((p) => p.dir)].filter(Boolean))
    .catch(() => roots);
}

async function start(): Promise<void> {
  pruneLogs();
  log(
    "shell",
    `Testimus desktop ${SHELL_VERSION} (Electron ${process.versions.electron}) starting${args.mock ? " --mock" : ""}`,
  );
  lockSession(session.defaultSession);
  hiddenMenu(!packaged);
  registerBridge({
    window: () => win,
    origin: () => origin,
    shellPage: pathToFileURL(ERROR_PAGE).href,
    icon: LOGO,
    version: { shell: SHELL_VERSION, electron: process.versions.electron, chrome: process.versions.chrome },
    knownRoots,
    details: () => ({ message: errorMessage, lines: lastLines(), logDir: logDir() }),
    restart: () => {
      restart();
    },
    openLogs: () => {
      mkdirSync(logDir(), { recursive: true });
      shell.openPath(logDir());
    },
    relaunch: () => {
      if (closing) return;
      relaunching = true;
      requestQuit();
    },
  });
  win = createWindow();
  await launchCore();
}

// ponytail: the fuses turn Node's inspector off; Chromium's own remote debugging is refused too once packaged, so no
// other program can drive the window and its session cookie
const debugging = ["remote-debugging-port", "remote-debugging-pipe", "inspect", "inspect-brk"].some((s) =>
  app.commandLine.hasSwitch(s),
);

if (packaged && debugging) {
  app.exit(2);
} else if (!app.requestSingleInstanceLock({ folder: args.folder })) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, cwd, data) => {
    const sent = (data as { folder?: unknown } | null)?.folder;
    const folder = typeof sent === "string" && isDir(sent) ? sent : shellArgs(argv, cwd, isDir).folder;
    log("shell", `second launch${folder ? ` with ${folder}` : ""}`);
    focus();
    if (folder) {
      pendingFolder = folder;
      sendFolder();
    }
  });
  app.on("web-contents-created", (_event, contents) => lockContents(contents, () => origin));
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", (event) => {
    if (shutDown || (!coreAlive(core) && !uiDev)) return;
    event.preventDefault();
    shutdown().then(() => app.quit());
  });
  app.whenReady().then(start);
}
