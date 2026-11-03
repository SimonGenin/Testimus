import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Fn = (...a: any[]) => any;
  class Em {
    l: Record<string, Fn[]> = {};
    on(n: string, f: Fn) {
      this.l[n] = [...(this.l[n] ?? []), f];
      return this;
    }
    once(n: string, f: Fn) {
      const w = (...a: unknown[]) => {
        this.l[n] = (this.l[n] ?? []).filter((x) => x !== w);
        f(...a);
      };
      return this.on(n, w);
    }
    emit(n: string, ...a: unknown[]) {
      for (const f of [...(this.l[n] ?? [])]) f(...a);
    }
  }
  const cfg = {
    packaged: false,
    switches: [] as string[],
    lock: true,
    dark: false,
    loadFileFails: false,
  };
  class FakeWindow extends Em {
    static all: FakeWindow[] = [];
    static getFocusedWindow = () => null;
    opts: Record<string, any>;
    url = "";
    destroyed = false;
    minimized = false;
    maximized = false;
    zoomF = 1;
    webContents = Object.assign(new Em(), {
      send: vi.fn(),
      getURL: () => this.url,
      setZoomFactor: vi.fn((z: number) => {
        this.zoomF = z;
      }),
      getZoomFactor: () => this.zoomF,
    });
    constructor(opts: Record<string, any>) {
      super();
      this.opts = opts;
      FakeWindow.all.push(this);
    }
    loadFile = vi.fn(async (p: string) => {
      if (cfg.loadFileFails) throw new Error("load failed");
      this.url = `file:///${p.replace(/\\/g, "/")}`;
    });
    loadURL = vi.fn(async (u: string) => {
      this.url = u;
    });
    isDestroyed = () => this.destroyed;
    isMinimized = () => this.minimized;
    isMaximized = () => this.maximized;
    restore = vi.fn(() => {
      this.minimized = false;
    });
    show = vi.fn();
    focus = vi.fn();
    hide = vi.fn();
    setProgressBar = vi.fn();
    setMenuBarVisibility = vi.fn();
    setAppDetails = vi.fn();
    maximize = vi.fn(() => {
      this.maximized = true;
    });
    getNormalBounds = () => ({ x: 10, y: 20, width: 1000, height: 700 });
    close = vi.fn(() => {
      const ev = { prevented: false, preventDefault: () => (ev.prevented = true) };
      this.emit("close", ev);
      if (!ev.prevented) {
        this.destroyed = true;
        this.emit("closed");
      }
    });
  }
  const build = () => {
    const app = Object.assign(new Em(), {
      get isPackaged() {
        return cfg.packaged;
      },
      setPath: vi.fn(),
      setAppUserModelId: vi.fn(),
      commandLine: { hasSwitch: (s: string) => cfg.switches.includes(s) },
      exit: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => cfg.lock),
      whenReady: () => Promise.resolve(),
    });
    const handle: Record<string, Fn> = {};
    const on: Record<string, Fn> = {};
    return {
      app,
      BrowserWindow: FakeWindow,
      dialog: { showMessageBox: vi.fn(async (..._a: unknown[]) => ({ response: 0 })), showOpenDialog: vi.fn() },
      nativeTheme: {
        get shouldUseDarkColors() {
          return cfg.dark;
        },
      },
      screen: {
        getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
        getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      },
      session: {
        defaultSession: {
          cookies: {
            get: vi.fn(async (..._a: unknown[]) => [{ value: "abc" }]),
            set: vi.fn(async (..._a: unknown[]) => {}),
          },
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          on: vi.fn(),
        },
      },
      shell: { openPath: vi.fn(async () => ""), openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() },
      Menu: { buildFromTemplate: (t: unknown) => ({ template: t }), setApplicationMenu: vi.fn() },
      ipcMain: {
        handle: (n: string, f: Fn) => {
          handle[n] = f;
        },
        on: (n: string, f: Fn) => {
          on[n] = f;
        },
      },
      Notification: { isSupported: () => false },
      handle,
      on,
    };
  };
  const core = {
    startCore: vi.fn(),
    stopCore: vi.fn(),
    killTree: vi.fn(),
    findNode: vi.fn(),
    runningJobs: vi.fn(),
    cancelJobs: vi.fn(),
    sessionCookie: vi.fn(),
    api: vi.fn(),
    waitHttp: vi.fn(),
    startUiDev: vi.fn(),
  };
  const logs = {
    log: vi.fn(),
    pruneLogs: vi.fn(),
    clearTail: vi.fn(),
    lastLines: vi.fn(() => ["core line"]),
    dirs: { data: "", local: "", home: "" },
  };
  return { cfg, FakeWindow, build, e: null as unknown as ReturnType<typeof build>, core, logs };
});

vi.mock("electron", () => ({
  get app() {
    return h.e.app;
  },
  get BrowserWindow() {
    return h.e.BrowserWindow;
  },
  get dialog() {
    return h.e.dialog;
  },
  get nativeTheme() {
    return h.e.nativeTheme;
  },
  get screen() {
    return h.e.screen;
  },
  get session() {
    return h.e.session;
  },
  get shell() {
    return h.e.shell;
  },
  get Menu() {
    return h.e.Menu;
  },
  get ipcMain() {
    return h.e.ipcMain;
  },
  get Notification() {
    return h.e.Notification;
  },
}));

vi.mock("node:os", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:os")>();
  const homedir = () => h.logs.dirs.home || real.homedir();
  return { ...real, homedir, default: { ...real, homedir } };
});

vi.mock("../../../src/desktop/core.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/desktop/core.ts")>();
  const c = h.core;
  return {
    ...real,
    startCore: (...a: unknown[]) => c.startCore(...a),
    stopCore: (...a: unknown[]) => c.stopCore(...a),
    killTree: (...a: unknown[]) => c.killTree(...a),
    findNode: (...a: unknown[]) => c.findNode(...a),
    runningJobs: (...a: unknown[]) => c.runningJobs(...a),
    cancelJobs: (...a: unknown[]) => c.cancelJobs(...a),
    sessionCookie: (...a: unknown[]) => c.sessionCookie(...a),
    api: (...a: unknown[]) => c.api(...a),
    waitHttp: (...a: unknown[]) => c.waitHttp(...a),
    startUiDev: (...a: unknown[]) => c.startUiDev(...a),
  };
});

vi.mock("../../../src/desktop/log.ts", async (importOriginal) => {
  const { join: j } = await import("node:path");
  const real = await importOriginal<typeof import("../../../src/desktop/log.ts")>();
  const l = h.logs;
  return {
    ...real,
    log: (...a: unknown[]) => l.log(...a),
    pruneLogs: () => l.pruneLogs(),
    clearTail: () => l.clearTail(),
    lastLines: () => l.lastLines(),
    dataDir: () => l.dirs.data,
    localDir: () => l.dirs.local,
    logDir: () => j(l.dirs.local, "logs"),
  };
});

type Win = InstanceType<typeof h.FakeWindow>;
type FakeCore = {
  core: {
    child: { pid?: number; exitCode: number | null; signalCode: string | null };
    ready: Promise<unknown>;
    exited: Promise<number | null>;
  };
  ready(r?: Record<string, unknown>): void;
  fail(e: unknown): void;
  exit(code: number | null): void;
};

const ORIGIN = "http://127.0.0.1:5000";
const READY = { url: `${ORIGIN}/`, origin: ORIGIN, pid: 4242, version: "0.9.0" };
const DESKTOP = join(import.meta.dirname, "..", "..", "..", "src", "desktop");
const ERROR_URL = pathToFileURL(join(DESKTOP, "pages", "error.html")).href;
const MAIN = "../../../src/desktop/main.ts";
const argv0 = process.argv;

let cores: FakeCore[] = [];
let autoReady = true;
let root = "";
let project = "";

const makeCore = (): FakeCore => {
  const child = { pid: 4242 + cores.length, exitCode: null as number | null, signalCode: null as string | null };
  let ok: (r: unknown) => void = () => {};
  let ko: (e: unknown) => void = () => {};
  let ex: (c: number | null) => void = () => {};
  const ready = new Promise((a, b) => {
    ok = a;
    ko = b;
  });
  ready.catch(() => {});
  const exited = new Promise<number | null>((a) => {
    ex = a;
  });
  const f: FakeCore = {
    core: { child, ready, exited },
    ready: (r = READY) => ok(r),
    fail: (e) => ko(e),
    exit: (code) => {
      child.exitCode = code ?? 1;
      ex(code);
    },
  };
  cores.push(f);
  if (autoReady) f.ready();
  return f;
};

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

const boot = async (argv: string[] = [], over: Partial<typeof h.cfg> = {}) => {
  Object.assign(h.cfg, { packaged: false, switches: [], lock: true, dark: false, loadFileFails: false }, over);
  h.e = h.build();
  h.FakeWindow.all = [];
  process.argv = [process.execPath, "main.mjs", ...argv];
  vi.resetModules();
  await import(MAIN);
  await flush();
  return h.e;
};

const win = (): Win => h.FakeWindow.all.at(-1) as Win;
const logged = () => h.logs.log.mock.calls.map((c) => c[1] as string);
const appOn = (name: string, ...args: unknown[]) => h.e.app.emit(name, ...args);
const ev = () => {
  const e = { prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
};
const shellCall = (name: string) =>
  h.e.handle[`testimus:${name}`]({ sender: win().webContents, senderFrame: { parent: null, url: ERROR_URL } });
const appCall = (name: string, ...args: unknown[]) =>
  h.e.handle[`testimus:${name}`]({ sender: win().webContents, senderFrame: { parent: null, url: win().url } }, ...args);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-cov-main-"));
  project = join(root, "project");
  mkdirSync(project);
  h.logs.dirs.data = join(root, "roaming");
  h.logs.dirs.home = join(root, "home");
  h.logs.dirs.local = join(root, "local");
  cores = [];
  autoReady = true;
  for (const f of Object.values(h.core)) f.mockReset();
  h.logs.log.mockReset();
  h.logs.pruneLogs.mockReset();
  h.core.startCore.mockImplementation(() => makeCore().core);
  h.core.stopCore.mockImplementation(async (c: FakeCore["core"]) => {
    c.child.exitCode = 0;
  });
  h.core.findNode.mockReturnValue("C:\\node\\node.exe");
  h.core.runningJobs.mockResolvedValue([]);
  h.core.cancelJobs.mockResolvedValue(undefined);
  h.core.sessionCookie.mockResolvedValue("testimus_session=fresh");
  h.core.api.mockResolvedValue({ last: project, projects: [{ dir: join(root, "other") }] });
  h.core.waitHttp.mockResolvedValue(true);
  h.core.startUiDev.mockReturnValue({ pid: 77 });
});

afterEach(() => {
  process.argv = argv0;
});

describe("before the window", () => {
  it("refuses to run packaged with a debugging switch", async () => {
    const e = await boot([], { packaged: true, switches: ["remote-debugging-port"] });
    expect(e.app.exit).toHaveBeenCalledWith(2);
    expect(e.app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(h.FakeWindow.all).toHaveLength(0);
  });

  it("lets a developer debug an unpackaged shell", async () => {
    const e = await boot([], { switches: ["inspect"] });
    expect(e.app.exit).not.toHaveBeenCalled();
    expect(h.FakeWindow.all).toHaveLength(1);
  });

  it("hands over to the instance already running, with the folder asked for", async () => {
    const e = await boot([project], { lock: false });
    expect(e.app.requestSingleInstanceLock).toHaveBeenCalledWith({ folder: project });
    expect(e.app.quit).toHaveBeenCalled();
    expect(h.FakeWindow.all).toHaveLength(0);
  });
});

describe("start", () => {
  it("locks the session, builds the dev menu, starts the core and opens the folder of the command line", async () => {
    mkdirSync(h.logs.dirs.data, { recursive: true });
    writeFileSync(
      join(h.logs.dirs.data, "window.json"),
      JSON.stringify({ x: 50, y: 60, width: 1200, height: 800, maximized: true, zoom: 1.25 }),
    );
    const e = await boot(["--mock", project]);
    expect(e.app.setPath).toHaveBeenCalledWith("userData", join(h.logs.dirs.data, "desktop"));
    expect(h.logs.pruneLogs).toHaveBeenCalled();
    expect(logged()[0]).toMatch(/^Testimus desktop .* starting --mock$/);
    expect(e.session.defaultSession.setPermissionRequestHandler).toHaveBeenCalled();
    const menu = e.Menu.setApplicationMenu.mock.calls[0][0] as { template: { submenu: { role?: string }[] }[] };
    expect(menu.template[1].submenu.some((i) => i.role === "toggleDevTools")).toBe(true);
    const w = win();
    expect(w.opts).toMatchObject({
      x: 50,
      y: 60,
      width: 1200,
      height: 800,
      minWidth: 520,
      minHeight: 600,
      show: false,
      title: "Testimus",
      backgroundColor: "#f4f6f6",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    expect(w.opts.webPreferences.preload).toBe(join(DESKTOP, "preload.cjs"));
    expect(w.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(e.app.setAppUserModelId).toHaveBeenCalledWith("Testimus");
    expect(w.opts.icon).toBe(join(DESKTOP, "pages", "logo.png"));
    if (process.platform === "win32")
      expect(w.setAppDetails).toHaveBeenCalledWith({
        appId: "Testimus",
        appIconPath: join(DESKTOP, "pages", "testimus.ico"),
        relaunchCommand: `"${process.execPath}" "${join(DESKTOP, "main.mjs")}"`,
        relaunchDisplayName: "Testimus",
      });
    else expect(w.setAppDetails).not.toHaveBeenCalled();
    expect(w.maximize).toHaveBeenCalled();
    const [launch, env] = h.core.startCore.mock.calls[0] as [{ command: string; args: string[] }, NodeJS.ProcessEnv];
    expect(launch.command).toBe("C:\\node\\node.exe");
    expect(launch.args.at(-1)).toBe("--mock");
    expect(env.TESTIMUS_SHELL).toMatch(/^desktop\//);
    expect(w.loadFile.mock.calls[0][0]).toBe(join(DESKTOP, "pages", "splash.html"));
    expect(w.loadURL).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(w.webContents.setZoomFactor).toHaveBeenCalledWith(1.25);
    expect(w.webContents.send).toHaveBeenCalledWith("testimus:open-project", project);
    expect(logged()).toContain("core ready on http://127.0.0.1:5000/ (pid 4242, version 0.9.0)");
    w.emit("ready-to-show");
    expect(w.show).toHaveBeenCalled();
    w.webContents.emit("did-finish-load");
    expect(w.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("asks the core for the port of the last session, with a fallback when it is taken", async () => {
    mkdirSync(h.logs.dirs.data, { recursive: true });
    writeFileSync(
      join(h.logs.dirs.data, "window.json"),
      JSON.stringify({ x: 0, y: 0, width: 1200, height: 800, maximized: false, zoom: 1, port: 51234 }),
    );
    await boot([]);
    const [launch] = h.core.startCore.mock.calls[0] as [{ args: string[] }];
    const at = launch.args.indexOf("--port");
    expect(launch.args.slice(at, at + 2)).toEqual(["--port", "51234"]);
    expect(launch.args).toContain("--port-fallback");
  });

  it("starts the shipped core packaged, without devtools, on a dark background", async () => {
    autoReady = false;
    const e = await boot([], { packaged: true, dark: true });
    const [launch, env] = h.core.startCore.mock.calls[0] as [{ command: string; args: string[] }, NodeJS.ProcessEnv];
    expect(launch.command).toBe(join(process.execPath, "..", "node", "node.exe"));
    expect(launch.args).not.toContain("--mock");
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
    expect(win().opts.backgroundColor).toBe("#0b0f0f");
    if (process.platform === "win32")
      expect(win().setAppDetails).toHaveBeenCalledWith({
        appId: "Testimus",
        appIconPath: process.execPath,
        relaunchCommand: `"${process.execPath}"`,
        relaunchDisplayName: "Testimus",
      });
    else expect(win().setAppDetails).not.toHaveBeenCalled();
    const menu = e.Menu.setApplicationMenu.mock.calls[0][0] as { template: { submenu: { role?: string }[] }[] };
    expect(menu.template[1].submenu.some((i) => i.role === "toggleDevTools")).toBe(false);
    cores[0].ready({ url: `${ORIGIN}/`, origin: ORIGIN });
    await flush();
    expect(logged()).toContain("core ready on http://127.0.0.1:5000/ (pid 4242, version ?)");
    expect(win().maximize).not.toHaveBeenCalled();
  });

  it("goes on when the splash or the error page fails to load", async () => {
    await boot([], { loadFileFails: true });
    expect(win().loadURL).toHaveBeenCalledWith(`${ORIGIN}/`);
    cores[0].exit(1);
    await flush();
    expect(win().loadFile).toHaveBeenCalledTimes(2);
    expect((await shellCall("details")).message).toBe("The core stopped (exit code 1).");
  });

  it("logs a failed load of the app page", async () => {
    autoReady = false;
    await boot();
    win().loadURL.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
    cores[0].ready();
    await flush();
    expect(logged()).toContain(`load ${ORIGIN}/: ERR_CONNECTION_REFUSED`);
    expect(win().webContents.setZoomFactor).toHaveBeenCalled();
    win().loadURL.mockRejectedValueOnce("plain");
    await shellCall("restart");
    await flush();
    cores[1].ready();
    await flush();
    expect(logged()).toContain(`load ${ORIGIN}/: plain`);
  });

  it("does not load the app into a window destroyed while the core started", async () => {
    autoReady = false;
    await boot();
    win().destroyed = true;
    cores[0].ready();
    await flush();
    expect(win().loadURL).not.toHaveBeenCalled();
  });

  it("does not zoom a window destroyed while the app loaded", async () => {
    autoReady = false;
    await boot();
    win().loadURL.mockImplementationOnce(async () => {
      win().destroyed = true;
    });
    cores[0].ready();
    await flush();
    expect(win().webContents.setZoomFactor).not.toHaveBeenCalled();
  });
});

describe("core failures", () => {
  it("shows the error page when Node is missing in development", async () => {
    h.core.findNode.mockReturnValue(null);
    await boot();
    expect(h.core.startCore).not.toHaveBeenCalled();
    expect(win().loadFile.mock.calls.at(-1)?.[0]).toBe(join(DESKTOP, "pages", "error.html"));
    expect(win().setProgressBar).toHaveBeenCalledWith(-1);
    expect(await shellCall("details")).toEqual({
      message: expect.stringMatching(/^Node was not found on the PATH/),
      lines: ["core line"],
      logDir: join(h.logs.dirs.local, "logs"),
    });
  });

  it("shows a non-Error thrown by the launch as text", async () => {
    h.core.startCore.mockImplementation(() => {
      throw "spawn EPERM";
    });
    await boot();
    expect((await shellCall("details")).message).toBe("spawn EPERM");
  });

  it("shows why the core never got ready", async () => {
    autoReady = false;
    await boot();
    cores[0].fail(new Error("The core did not answer within 30 s."));
    await flush();
    expect((await shellCall("details")).message).toBe("The core did not answer within 30 s.");
    await shellCall("restart");
    await flush();
    cores[1].fail("odd");
    await flush();
    expect((await shellCall("details")).message).toBe("odd");
  });

  it("shows the error page when the core stops after it was ready, but not for a core it replaced", async () => {
    await boot();
    cores[0].exit(1);
    await flush();
    expect((await shellCall("details")).message).toBe("The core stopped (exit code 1).");
    expect(win().url).toBe(`file:///${join(DESKTOP, "pages", "error.html").replace(/\\/g, "/")}`);
    await shellCall("restart");
    await flush();
    expect(h.core.stopCore).not.toHaveBeenCalled();
    expect(win().url).toBe(`${ORIGIN}/`);
    cores[1].exit(null);
    await flush();
    expect((await shellCall("details")).message).toBe("The core stopped (exit code none).");
  });

  it("restart stops a live core within 3 s and ignores its exit", async () => {
    await boot();
    const old = cores[0];
    await shellCall("restart");
    await flush();
    expect(h.core.stopCore).toHaveBeenCalledWith(old.core, 3000);
    expect(h.core.startCore).toHaveBeenCalledTimes(2);
    old.exit(0);
    await flush();
    expect(win().url).toBe(`${ORIGIN}/`);
  });

  it("treats a core killed by a signal as stopped", async () => {
    await boot();
    cores[0].core.child.signalCode = "SIGKILL";
    await shellCall("restart");
    await flush();
    expect(h.core.stopCore).not.toHaveBeenCalled();
  });
});

describe("--ui-dev", () => {
  it("needs Node on the PATH to run Vite", async () => {
    h.core.findNode.mockReturnValueOnce("C:\\node\\node.exe").mockReturnValueOnce(null);
    await boot(["--ui-dev"]);
    expect((await shellCall("details")).message).toBe("Node was not found on the PATH: --ui-dev needs it to run Vite.");
    expect(h.core.startUiDev).not.toHaveBeenCalled();
  });

  it("says when Vite does not answer", async () => {
    h.core.waitHttp.mockResolvedValue(false);
    await boot(["--ui-dev"]);
    expect(h.core.startUiDev).toHaveBeenCalledWith("C:\\node\\node.exe", expect.any(String), ORIGIN);
    expect(h.core.waitHttp).toHaveBeenCalledWith("http://localhost:4318/", 30_000);
    expect((await shellCall("details")).message).toBe("Vite did not answer on http://localhost:4318/.");
  });

  it("loads Vite with the core's session cookie, and kills Vite on restart and quit", async () => {
    const e = await boot(["--ui-dev", project]);
    expect(e.session.defaultSession.cookies.set).toHaveBeenCalledWith({
      url: "http://localhost:4318/",
      name: "testimus_session",
      value: "fresh",
      path: "/",
      httpOnly: true,
      sameSite: "strict",
    });
    expect(win().loadURL).toHaveBeenCalledWith("http://localhost:4318/");
    expect(win().webContents.send).toHaveBeenCalledWith("testimus:open-project", project);
    h.core.sessionCookie.mockResolvedValueOnce("odd");
    await shellCall("restart");
    await flush();
    expect(h.core.killTree).toHaveBeenCalledWith(77);
    expect(e.session.defaultSession.cookies.set.mock.calls.at(-1)?.[0]).toMatchObject({ value: "" });
    cores[1].core.child.exitCode = 0;
    const quit = ev();
    appOn("will-quit", quit);
    expect(quit.prevented).toBe(true);
    await flush();
    expect(h.core.killTree).toHaveBeenCalledTimes(2);
    expect(e.app.quit).toHaveBeenCalled();
  });

  it("skips the cookie when the core gives none", async () => {
    h.core.sessionCookie.mockRejectedValue(new Error("down"));
    h.core.startUiDev.mockReturnValue({});
    const e = await boot(["--ui-dev"]);
    expect(e.session.defaultSession.cookies.set).not.toHaveBeenCalled();
    await shellCall("restart");
    await flush();
    expect(h.core.killTree).not.toHaveBeenCalled();
  });
});

describe("second launch", () => {
  it("focuses the window and opens the folder it was given", async () => {
    await boot();
    const w = win();
    w.minimized = true;
    appOn("second-instance", {}, ["Testimus.exe"], root, { folder: project });
    expect(w.restore).toHaveBeenCalled();
    expect(w.show).toHaveBeenCalled();
    expect(w.focus).toHaveBeenCalled();
    expect(w.webContents.send).toHaveBeenCalledWith("testimus:open-project", project);
    expect(logged()).toContain(`second launch with ${project}`);
  });

  it("reads the folder from the command line when the data has none, and keeps it while the error page shows", async () => {
    await boot();
    const w = win();
    cores[0].exit(1);
    await flush();
    appOn("second-instance", {}, ["Testimus.exe", "project"], root, { folder: join(root, "missing") });
    expect(w.restore).not.toHaveBeenCalled();
    expect(w.webContents.send).not.toHaveBeenCalled();
    await shellCall("restart");
    await flush();
    expect(w.webContents.send).toHaveBeenCalledWith("testimus:open-project", project);
  });

  it("only focuses without a folder, and does nothing once the window is gone", async () => {
    await boot();
    const w = win();
    appOn("second-instance", {}, ["Testimus.exe"], root, null);
    expect(logged()).toContain("second launch");
    expect(w.focus).toHaveBeenCalledTimes(1);
    w.destroyed = true;
    appOn("second-instance", {}, ["Testimus.exe"], root, { folder: 5 });
    expect(w.focus).toHaveBeenCalledTimes(1);
    w.emit("closed");
    appOn("second-instance", {}, ["Testimus.exe"], root, { folder: project });
    expect(w.webContents.send).not.toHaveBeenCalled();
  });
});

describe("app events", () => {
  it("locks every new web contents to the current core origin", async () => {
    await boot();
    const handlers: Record<string, (e: { url: string; preventDefault(): void }) => void> = {};
    const contents = {
      on: (n: string, f: (e: { url: string; preventDefault(): void }) => void) => {
        handlers[n] = f;
      },
      setWindowOpenHandler: vi.fn(),
    };
    appOn("web-contents-created", {}, contents);
    const inside = { url: `${ORIGIN}/#/x`, preventDefault: vi.fn() };
    handlers["will-navigate"](inside);
    expect(inside.preventDefault).not.toHaveBeenCalled();
    const outside = { url: "https://evil.example/", preventDefault: vi.fn() };
    handlers["will-navigate"](outside);
    expect(outside.preventDefault).toHaveBeenCalled();
  });

  it("quits when the last window closes", async () => {
    const e = await boot();
    appOn("window-all-closed");
    expect(e.app.quit).toHaveBeenCalled();
  });

  it("lets the app quit at once when no core runs", async () => {
    const e = await boot();
    cores[0].exit(0);
    await flush();
    const quit = ev();
    appOn("will-quit", quit);
    expect(quit.prevented).toBe(false);
    expect(e.app.quit).not.toHaveBeenCalled();
  });

  it("stops a running core before the app quits, once", async () => {
    const e = await boot();
    const quit = ev();
    appOn("will-quit", quit);
    expect(quit.prevented).toBe(true);
    await flush();
    expect(h.core.stopCore).toHaveBeenCalledTimes(1);
    expect(h.core.stopCore.mock.calls[0]).toEqual([cores[0].core]);
    expect(e.app.quit).toHaveBeenCalled();
    expect(logged()).toContain("stopped");
    const again = ev();
    appOn("will-quit", again);
    expect(again.prevented).toBe(false);
  });
});

describe("bridge from the main process", () => {
  it("answers the versions and opens the log folder", async () => {
    const e = await boot();
    expect(await appCall("version")).toMatchObject({ shell: expect.any(String) });
    await shellCall("openLogs");
    expect(e.shell.openPath).toHaveBeenCalledWith(join(h.logs.dirs.local, "logs"));
  });

  it("reveals a file of a project the core knows, asked with the window's cookie", async () => {
    const e = await boot();
    const file = join(project, "test.md");
    writeFileSync(file, "x");
    expect(await appCall("reveal", file)).toBe(true);
    expect(h.core.api).toHaveBeenCalledWith(ORIGIN, "testimus_session=abc", "project.list", {});
    expect(e.shell.showItemInFolder).toHaveBeenCalledWith(file);
  });

  it("falls back to a fresh cookie, then to none, then to the data and Atlassian folders only", async () => {
    const e = await boot();
    const file = join(project, "test.md");
    writeFileSync(file, "x");
    e.session.defaultSession.cookies.get.mockResolvedValueOnce([]);
    expect(await appCall("reveal", file)).toBe(true);
    expect(h.core.api.mock.calls.at(-1)?.[1]).toBe("testimus_session=fresh");
    e.session.defaultSession.cookies.get.mockRejectedValueOnce(new Error("no cookies"));
    h.core.sessionCookie.mockRejectedValueOnce(new Error("down"));
    expect(await appCall("reveal", file)).toBe(true);
    expect(h.core.api.mock.calls.at(-1)?.[1]).toBe("");
    h.core.api.mockResolvedValueOnce({ last: "", projects: [] });
    expect(await appCall("reveal", file)).toBe(false);
    h.core.api.mockRejectedValueOnce(new Error("HTTP 403"));
    expect(await appCall("reveal", file)).toBe(false);
    mkdirSync(h.logs.dirs.data, { recursive: true });
    const settings = join(h.logs.dirs.data, "settings.json");
    writeFileSync(settings, "{}");
    h.core.api.mockRejectedValueOnce(new Error("HTTP 403"));
    expect(await appCall("reveal", settings)).toBe(true);
    mkdirSync(join(h.logs.dirs.home, ".atlassian"), { recursive: true });
    const token = join(h.logs.dirs.home, ".atlassian", "LFRPS12.json");
    writeFileSync(token, "{}");
    h.core.api.mockRejectedValueOnce(new Error("HTTP 403"));
    expect(await appCall("reveal", token)).toBe(true);
    const elsewhere = join(h.logs.dirs.home, "secret.txt");
    writeFileSync(elsewhere, "x");
    expect(await appCall("reveal", elsewhere)).toBe(false);
  });
});

describe("quit", () => {
  const job = {
    id: "g1",
    kind: "generate",
    subject: "Sectionneur",
    status: "running",
    progress: { done: 1, total: 4 },
  };
  const windowJson = () => JSON.parse(readFileSync(join(h.logs.dirs.data, "window.json"), "utf8"));

  it("quits at once when no job runs, saving the window and stopping the core", async () => {
    const e = await boot();
    const w = win();
    w.zoomF = 1.5;
    w.close();
    await flush();
    expect(h.core.runningJobs).toHaveBeenCalledWith(ORIGIN, "testimus_session=abc", 4242);
    expect(e.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(windowJson()).toEqual({ x: 10, y: 20, width: 1000, height: 700, maximized: false, zoom: 1.5, port: 5000 });
    expect(w.hide).toHaveBeenCalled();
    expect(h.core.stopCore).toHaveBeenCalledWith(cores[0].core);
    expect(w.close).toHaveBeenCalledTimes(2);
    expect(w.destroyed).toBe(true);
    const quit = ev();
    appOn("will-quit", quit);
    expect(quit.prevented).toBe(false);
  });

  it("asks with the running jobs, keeps working, then cancels them and quits", async () => {
    const e = await boot();
    const w = win();
    h.core.runningJobs.mockResolvedValue([job]);
    e.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    w.close();
    await flush();
    const [parent, opts] = e.dialog.showMessageBox.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(parent).toBe(w);
    expect(opts).toMatchObject({
      type: "warning",
      message: "A job is still running.",
      buttons: ["Cancel and quit", "Keep working"],
      defaultId: 1,
      cancelId: 1,
    });
    expect(String(opts.detail)).toContain("Generate tests · Sectionneur — 1/4");
    expect(logged()).toContain("quit: keep working");
    expect(w.hide).not.toHaveBeenCalled();
    expect(h.core.cancelJobs).not.toHaveBeenCalled();
    w.close();
    await flush();
    expect(logged()).toContain("quit: cancel and quit");
    expect(h.core.cancelJobs).toHaveBeenCalledWith(ORIGIN, "testimus_session=abc", [job]);
    expect(w.destroyed).toBe(true);
  });

  it("asks once even when the window is closed twice", async () => {
    const e = await boot();
    h.core.runningJobs.mockResolvedValue([job]);
    let answer: (v: { response: number }) => void = () => {};
    e.dialog.showMessageBox.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    win().close();
    await flush();
    win().close();
    await flush();
    expect(e.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    answer({ response: 0 });
    await flush();
    expect(win().destroyed).toBe(true);
  });

  it("quits when the job list or the dialog fails", async () => {
    const e = await boot();
    h.core.runningJobs.mockRejectedValueOnce(new Error("down"));
    win().close();
    await flush();
    expect(e.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(win().destroyed).toBe(true);

    await boot();
    h.core.runningJobs.mockResolvedValue([job]);
    h.e.dialog.showMessageBox.mockRejectedValueOnce(new Error("no dialog"));
    win().close();
    await flush();
    expect(logged()).toContain("quit check failed: no dialog");
    expect(win().destroyed).toBe(true);

    await boot();
    h.e.dialog.showMessageBox.mockRejectedValueOnce("odd");
    win().close();
    await flush();
    expect(logged()).toContain("quit check failed: odd");
  });

  it("skips the job check when the core is down and keeps the saved zoom off the app page", async () => {
    await boot();
    const w = win();
    w.zoomF = 1.75;
    cores[0].exit(1);
    await flush();
    w.close();
    await flush();
    expect(h.core.runningJobs).not.toHaveBeenCalled();
    expect(h.core.stopCore).not.toHaveBeenCalled();
    expect(windowJson().zoom).toBe(1);
    expect(w.destroyed).toBe(true);
  });

  it("does not show an error when the core fails while quitting", async () => {
    autoReady = false;
    await boot();
    const w = win();
    w.close();
    await flush();
    expect(h.core.stopCore).toHaveBeenCalledTimes(1);
    cores[0].fail(new Error("late"));
    await flush();
    expect(w.loadFile).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the window is gone", async () => {
    await boot();
    const w = win();
    w.emit("closed");
    w.emit("close", ev());
    await flush();
    expect(h.core.runningJobs).not.toHaveBeenCalled();
    expect(w.hide).not.toHaveBeenCalled();
  });

  it("saves and stops at the end of the Windows session without asking", async () => {
    const e = await boot();
    const w = win();
    w.emit("session-end");
    await flush();
    expect(windowJson()).toMatchObject({ x: 10, y: 20 });
    expect(h.core.stopCore).toHaveBeenCalledTimes(1);
    const close = ev();
    w.emit("close", close);
    expect(close.prevented).toBe(false);
    const quit = ev();
    appOn("will-quit", quit);
    expect(quit.prevented).toBe(false);
    expect(e.dialog.showMessageBox).not.toHaveBeenCalled();
    w.destroyed = true;
    w.emit("session-end");
    await flush();
    expect(h.core.stopCore).toHaveBeenCalledTimes(1);
  });
});
