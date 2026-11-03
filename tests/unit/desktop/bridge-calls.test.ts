import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Hello = { returnValue?: unknown; sender?: unknown; senderFrame?: unknown };
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const notifications: { opts: unknown; click?: () => void; shown: boolean }[] = [];
  class FakeNotification {
    static supported = true;
    static isSupported = () => FakeNotification.supported;
    entry: { opts: unknown; click?: () => void; shown: boolean };
    constructor(opts: unknown) {
      this.entry = { opts, shown: false };
      notifications.push(this.entry);
    }
    on(_name: string, fn: () => void) {
      this.entry.click = fn;
    }
    show() {
      this.entry.shown = true;
    }
  }
  return {
    on: {} as Record<string, (event: Hello) => void>,
    handle: {} as Record<string, (event: unknown, ...args: unknown[]) => unknown>,
    showOpenDialog: vi.fn(),
    showItemInFolder: vi.fn(),
    openPath: vi.fn(async () => ""),
    openExternal: vi.fn(async () => {}),
    notifications,
    FakeNotification,
  };
});

vi.mock("electron", () => ({
  dialog: { showOpenDialog: h.showOpenDialog },
  ipcMain: {
    on: (name: string, fn: (event: Hello) => void) => {
      h.on[name] = fn;
    },
    handle: (name: string, fn: Handler) => {
      h.handle[name] = fn;
    },
  },
  Notification: h.FakeNotification,
  shell: { showItemInFolder: h.showItemInFolder, openPath: h.openPath, openExternal: h.openExternal },
}));

const { httpsUrl, insideAny, registerBridge } = await import("../../../src/desktop/bridge.ts");

const ORIGIN = "http://127.0.0.1:53211";
const root = mkdtempSync(join(tmpdir(), "testimus-cov-bridge-"));
const ERROR_PAGE = pathToFileURL(join(root, "pages", "error.html")).href;
const project = join(root, "project");
const file = join(root, "inside.md");
writeFileSync(file, "x");

const makeWin = () => {
  const w = {
    webContents: {},
    focused: false,
    destroyed: false,
    minimized: true,
    setProgressBar: vi.fn(),
    onTop: false,
    setAlwaysOnTop: vi.fn((on: boolean) => {
      w.onTop = on;
    }),
    isAlwaysOnTop: () => w.onTop,
    isFocused: () => w.focused,
    isDestroyed: () => w.destroyed,
    isMinimized: () => w.minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return w;
};

let win: ReturnType<typeof makeWin> | null = makeWin();
let origin: string | null = ORIGIN;
const deps = {
  window: () => win as never,
  origin: () => origin,
  shellPage: ERROR_PAGE,
  icon: "C:\\x\\pages\\logo.png",
  version: { shell: "0.2.0", electron: "45.2.1", chrome: "140" },
  knownRoots: vi.fn(async () => [root]),
  details: vi.fn(() => ({ message: "boom", lines: ["a"], logDir: "L" })),
  restart: vi.fn(),
  openLogs: vi.fn(),
};
registerBridge(deps);

const event = (url: string, o: { other?: boolean; sub?: boolean; noFrame?: boolean } = {}) => ({
  sender: o.other ? {} : win?.webContents,
  senderFrame: o.noFrame ? undefined : { parent: o.sub ? {} : null, url },
});
const call = (name: string, ev: unknown, ...args: unknown[]) => h.handle[`testimus:${name}`](ev, ...args);
const page = (name: string, ...args: unknown[]) => call(name, event(`${ORIGIN}/#/tests`), ...args);

beforeEach(() => {
  win = makeWin();
  origin = ORIGIN;
  h.showOpenDialog.mockReset();
  h.showItemInFolder.mockReset();
  h.openExternal.mockClear();
  h.notifications.length = 0;
  h.FakeNotification.supported = true;
  deps.knownRoots.mockClear();
});

describe("hello", () => {
  it("tells the preload which role the page has", () => {
    const e: Hello = event(`${ORIGIN}/`);
    h.on["testimus:hello"](e);
    expect(e.returnValue).toBe("bridge");
    const s: Hello = event(`${ERROR_PAGE}#x`);
    h.on["testimus:hello"](s);
    expect(s.returnValue).toBe("shell");
    const child: Hello = event(`${ORIGIN}/`, { other: true });
    h.on["testimus:hello"](child);
    expect(child.returnValue).toBeNull();
    const noFrame: Hello = event("", { noFrame: true });
    h.on["testimus:hello"](noFrame);
    expect(noFrame.returnValue).toBeNull();
    win = null;
    const gone: Hello = { sender: {}, senderFrame: { parent: null, url: `${ORIGIN}/` } };
    h.on["testimus:hello"](gone);
    expect(gone.returnValue).toBeNull();
  });
});

describe("bridge calls", () => {
  it("are refused without a window, from another page, a sub-frame or the shell page", async () => {
    await expect(call("version", event(`${ORIGIN}/`, { sub: true }))).rejects.toThrow(/version refused/);
    await expect(call("version", event(`${ERROR_PAGE}`))).rejects.toThrow(/refused for this page/);
    await expect(call("details", event(`${ORIGIN}/`))).rejects.toThrow(/details refused/);
    win = null;
    await expect(call("version", event(`${ORIGIN}/`))).rejects.toThrow(/refused/);
  });

  it("refuse bad arguments with the check's message", async () => {
    await expect(page("reveal", "relative")).rejects.toThrow("reveal needs an absolute path.");
    await expect(page("setProgress", 2)).rejects.toThrow(/fraction/);
  });

  it("version answers the shell, Electron and Chrome versions", async () => {
    expect(await page("version")).toEqual(deps.version);
  });

  it.runIf(process.platform === "win32")(
    "pickFolder opens a folder dialog and gives the folder or null (Windows)",
    async () => {
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["D:\\p"] });
      expect(await page("pickFolder", { title: "Open", defaultPath: "D:\\Projects" })).toBe("D:\\p");
      expect(h.showOpenDialog).toHaveBeenCalledWith(win, {
        title: "Open",
        defaultPath: "D:\\Projects",
        properties: ["openDirectory", "createDirectory"],
      });
      h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await page("pickFolder", { title: "Open" })).toBeNull();
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
      expect(await page("pickFolder", { title: "Open" })).toBeNull();
    },
  );

  it.runIf(process.platform !== "win32")(
    "pickFolder opens a folder dialog and gives the folder or null (POSIX)",
    async () => {
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/p"] });
      expect(await page("pickFolder", { title: "Open", defaultPath: "/Projects" })).toBe("/p");
      expect(h.showOpenDialog).toHaveBeenCalledWith(win, {
        title: "Open",
        defaultPath: "/Projects",
        properties: ["openDirectory", "createDirectory"],
      });
      h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await page("pickFolder", { title: "Open" })).toBeNull();
      h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
      expect(await page("pickFolder", { title: "Open" })).toBeNull();
    },
  );

  it("pickFiles opens a file dialog, one or several", async () => {
    const filters = [{ name: "Documents", extensions: ["docx"] }];
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["D:\\a.docx", "D:\\b.docx"] });
    expect(await page("pickFiles", { title: "Add", filters, multiple: true })).toEqual(["D:\\a.docx", "D:\\b.docx"]);
    expect(h.showOpenDialog.mock.calls[0][1]).toEqual({
      title: "Add",
      filters,
      properties: ["openFile", "multiSelections"],
    });
    h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ["ignored"] });
    expect(await page("pickFiles", { title: "Add", filters, multiple: false })).toEqual([]);
    expect(h.showOpenDialog.mock.calls[1][1].properties).toEqual(["openFile"]);
  });

  it("reveal shows an existing file inside a known folder and refuses the rest", async () => {
    expect(await page("reveal", file)).toBe(true);
    expect(h.showItemInFolder).toHaveBeenCalledWith(file);
    expect(await page("reveal", join(root, "missing.md"))).toBe(false);
    deps.knownRoots.mockResolvedValueOnce([project]);
    expect(await page("reveal", file)).toBe(false);
    expect(h.showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it("reveal opens a folder itself in Explorer, as Xray Editor's « Open in Explorer »", async () => {
    expect(await page("reveal", root)).toBe(true);
    expect(h.openPath).toHaveBeenCalledWith(root);
    expect(h.showItemInFolder).not.toHaveBeenCalledWith(root);
  });

  it("openExternal hands the https link to the browser", async () => {
    expect(await page("openExternal", "https://claude.ai/")).toBe(true);
    expect(h.openExternal).toHaveBeenCalledWith("https://claude.ai/");
  });

  it("setProgress sets or clears the taskbar progress", async () => {
    await page("setProgress", 0.25);
    await page("setProgress", null);
    expect(win?.setProgressBar.mock.calls).toEqual([[0.25], [-1]]);
  });

  it("setAlwaysOnTop pins or unpins the window and answers its new state", async () => {
    expect(await page("setAlwaysOnTop", true)).toBe(true);
    expect(await page("setAlwaysOnTop", false)).toBe(false);
    expect(win?.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
    await expect(page("setAlwaysOnTop", "yes")).rejects.toThrow("setAlwaysOnTop takes true or false.");
    await expect(page("setAlwaysOnTop")).rejects.toThrow(/true or false/);
    expect(win?.setAlwaysOnTop).toHaveBeenCalledTimes(2);
  });

  it("notify shows a notification only when the window is not focused", async () => {
    expect(await page("notify", { title: "Done", body: "12 tests" })).toBe(true);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toMatchObject({
      opts: { title: "Done", body: "12 tests", icon: "C:\\x\\pages\\logo.png" },
      shown: true,
    });
    h.notifications[0].click?.();
    expect(win?.restore).toHaveBeenCalled();
    expect(win?.show).toHaveBeenCalled();
    expect(win?.focus).toHaveBeenCalled();
    if (win) win.minimized = false;
    h.notifications[0].click?.();
    expect(win?.restore).toHaveBeenCalledTimes(1);
    expect(win?.show).toHaveBeenCalledTimes(2);
    if (win) win.destroyed = true;
    h.notifications[0].click?.();
    expect(win?.show).toHaveBeenCalledTimes(2);
    if (win) win.focused = true;
    expect(await page("notify", { title: "Done", body: "" })).toBe(false);
    if (win) win.focused = false;
    h.FakeNotification.supported = false;
    expect(await page("notify", { title: "Done", body: "" })).toBe(false);
    expect(h.notifications).toHaveLength(1);
  });
});

describe("shell page calls", () => {
  const shellEvent = () => event(`${ERROR_PAGE}?t=1`);
  it("give the error details, restart the core and open the logs", async () => {
    expect(await call("details", shellEvent())).toEqual({ message: "boom", lines: ["a"], logDir: "L" });
    await call("restart", shellEvent());
    await call("openLogs", shellEvent());
    expect(deps.restart).toHaveBeenCalledTimes(1);
    expect(deps.openLogs).toHaveBeenCalledTimes(1);
  });
  it("are refused to the app page even with the core gone", async () => {
    deps.restart.mockClear();
    origin = null;
    await expect(call("restart", event(`${ORIGIN}/`))).rejects.toThrow(/refused/);
    expect(deps.restart).not.toHaveBeenCalled();
  });
});

describe("argument checks", () => {
  const refused = async (args: unknown) => {
    await expect(page("pickFiles", args)).rejects.toThrow(/pickFiles/);
  };
  it("pickFiles refuses a missing title and malformed filters", async () => {
    await refused(undefined);
    await refused({ filters: [], multiple: true });
    const f = (filters: unknown) => ({ title: "Add", filters, multiple: true });
    await refused(f(["docx"]));
    await refused(f([{ extensions: ["docx"] }]));
    await refused(f([{ name: "Docs", extensions: "docx" }]));
    await refused(f(Array.from({ length: 11 }, () => ({ name: "D", extensions: ["docx"] }))));
    await refused(f([{ name: "D", extensions: Array.from({ length: 21 }, () => "docx") }]));
    await refused(f([{ name: "D", extensions: [7] }]));
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("httpsUrl refuses text that is not a url", () => {
    expect(httpsUrl("not a url")).toBeNull();
    expect(httpsUrl("x".repeat(2049))).toBeNull();
  });

  it("insideAny resolves the paths as they are off Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(insideAny("/srv/Proj/a", ["/srv/Proj"])).toBe(true);
      expect(insideAny("/srv", ["/srv/Proj"])).toBe(false);
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });
});
