import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class FakeWindow {
    zoom = 1;
    webContents = {
      getZoomFactor: () => this.zoom,
      setZoomFactor: (z: number) => {
        this.zoom = z;
      },
    };
  }
  return {
    FakeWindow,
    focused: null as InstanceType<typeof FakeWindow> | null,
    menu: null as unknown,
    openExternal: vi.fn(async (_url: string) => {}),
  };
});

vi.mock("electron", () => ({
  BrowserWindow: Object.assign(h.FakeWindow, { getFocusedWindow: () => h.focused }),
  Menu: {
    buildFromTemplate: (t: unknown) => ({ template: t }),
    setApplicationMenu: (m: unknown) => {
      h.menu = m;
    },
  },
  shell: { openExternal: h.openExternal },
}));

const { clampState, hiddenMenu, lockContents, lockSession, nextZoom, readState, stateFile, writeState } = await import(
  "../../../src/desktop/window.ts"
);

type Item = { label?: string; role?: string; type?: string; click?: (item: unknown, win: unknown) => void };
type Template = { label: string; submenu: Item[] }[];

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-cov-window-"));
  vi.stubEnv("APPDATA", join(root, "roaming"));
  vi.stubEnv("LOCALAPPDATA", join(root, "local"));
  h.focused = null;
  h.menu = null;
  h.openExternal.mockReset();
  h.openExternal.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("window state file", () => {
  it("lives in the roaming data folder and round-trips by default", () => {
    expect(stateFile()).toBe(join(root, "roaming", "Testimus", "window.json"));
    expect(readState()).toEqual({});
    writeState({ x: 5, y: 6, width: 1200, height: 800, maximized: true, zoom: 1.1 });
    expect(readState()).toEqual({ x: 5, y: 6, width: 1200, height: 800, maximized: true, zoom: 1.1 });
  });

  it("logs and goes on when the state cannot be written", () => {
    writeFileSync(join(root, "blocker"), "x");
    expect(() =>
      writeState({ x: 0, y: 0, width: 1, height: 1, maximized: false, zoom: 1 }, join(root, "blocker", "w.json")),
    ).not.toThrow();
    const logs = readFileSync(
      join(root, "local", "Testimus", "logs", `desktop-${new Date().toISOString().slice(0, 10)}.log`),
      "utf8",
    );
    expect(logs).toContain("window state not saved");
  });

  it("drops a saved position whose title bar is below the display", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const s = clampState({ x: 100, y: 1000, width: 1000, height: 700 }, [area], area);
    expect(s.y).toBe(Math.round((1040 - 700) / 2));
  });

  it("shrinks a saved window to its display", () => {
    const area = { x: 0, y: 0, width: 1200, height: 700 };
    expect(clampState({ x: 10, y: 10, width: 3000, height: 3000 }, [area], area)).toMatchObject({
      x: 10,
      y: 10,
      width: 1200,
      height: 700,
    });
  });

  it("zooms out from above the largest step", () => {
    expect(nextZoom(3, -1)).toBe(1.75);
    expect(nextZoom(3, 1)).toBe(2);
    expect(nextZoom(0.5, -1)).toBe(0.5);
  });
});

describe("lockSession", () => {
  it("grants the clipboard write only and refuses every download", () => {
    const handlers: Record<string, (...a: unknown[]) => unknown> = {};
    const ses = {
      setPermissionRequestHandler: (fn: (...a: unknown[]) => unknown) => {
        handlers.request = fn;
      },
      setPermissionCheckHandler: (fn: (...a: unknown[]) => unknown) => {
        handlers.check = fn;
      },
      on: (name: string, fn: (...a: unknown[]) => unknown) => {
        handlers[name] = fn;
      },
    };
    lockSession(ses as never);
    const cb = vi.fn();
    handlers.request(null, "clipboard-sanitized-write", cb);
    handlers.request(null, "media", cb);
    expect(cb.mock.calls).toEqual([[true], [false]]);
    expect(handlers.check(null, "clipboard-sanitized-write")).toBe(true);
    expect(handlers.check(null, "geolocation")).toBe(false);
    const event = { preventDefault: vi.fn() };
    handlers["will-download"](event, { getURL: () => "https://example.com/x.exe" });
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("lockContents", () => {
  const ORIGIN = "http://127.0.0.1:53211";
  const make = (origin: string | null) => {
    const on: Record<string, (event: { url?: string; preventDefault(): void }) => void> = {};
    let open: (d: { url: string }) => unknown = () => null;
    const contents = {
      on: (name: string, fn: (event: { url?: string; preventDefault(): void }) => void) => {
        on[name] = fn;
      },
      setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => {
        open = fn;
      },
    };
    lockContents(contents as never, () => origin);
    return { on, open: (url: string) => open({ url }) };
  };
  const ev = (url?: string) => ({ url, preventDefault: vi.fn() });

  it("lets navigation and redirects stay on the core origin and stops the rest", () => {
    const c = make(ORIGIN);
    const inside = ev(`${ORIGIN}/#/review`);
    c.on["will-navigate"](inside);
    expect(inside.preventDefault).not.toHaveBeenCalled();
    const outside = ev("https://evil.example/");
    c.on["will-navigate"](outside);
    expect(outside.preventDefault).toHaveBeenCalled();
    const redirect = ev("http://127.0.0.1:1/");
    c.on["will-redirect"](redirect);
    expect(redirect.preventDefault).toHaveBeenCalled();
    const ok = ev(`${ORIGIN}/x`);
    c.on["will-redirect"](ok);
    expect(ok.preventDefault).not.toHaveBeenCalled();
    const broken = ev("::not a url");
    c.on["will-navigate"](broken);
    expect(broken.preventDefault).toHaveBeenCalled();
    const webview = ev();
    c.on["will-attach-webview"](webview);
    expect(webview.preventDefault).toHaveBeenCalled();
  });

  it("sends https links to the browser, opens project files locked, refuses other windows", async () => {
    const c = make(ORIGIN);
    h.openExternal.mockRejectedValueOnce(new Error("no browser"));
    expect(c.open("https://claude.ai/")).toEqual({ action: "deny" });
    expect(h.openExternal).toHaveBeenCalledWith("https://claude.ai/");
    const child = c.open(`${ORIGIN}/files/tests/a/img.png`) as {
      action: string;
      overrideBrowserWindowOptions: { autoHideMenuBar: boolean; webPreferences: Record<string, unknown> };
    };
    expect(child.action).toBe("allow");
    expect(child.overrideBrowserWindowOptions.autoHideMenuBar).toBe(true);
    expect(child.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      preload: undefined,
    });
    expect(c.open("file:///C:/x.png")).toEqual({ action: "deny" });
    expect(make(null).open(`${ORIGIN}/files/x.png`)).toEqual({ action: "deny" });
    await Promise.resolve();
  });
});

describe("hiddenMenu", () => {
  const view = () => (h.menu as { template: Template }).template.find((m) => m.label === "View")?.submenu ?? [];
  const click = (label: string, win: unknown) => {
    const item = view().find((i) => i.label === label);
    item?.click?.(null, win);
  };

  it("has the edit roles, the zoom keys and reload, plus devtools in development only", () => {
    hiddenMenu(true);
    const template = (h.menu as { template: Template }).template;
    expect(template.map((m) => m.label)).toEqual(["Edit", "View"]);
    expect(template[0].submenu.map((i) => i.role ?? i.type)).toEqual([
      "undo",
      "redo",
      "separator",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(view().some((i) => i.role === "toggleDevTools")).toBe(true);
    expect(view().some((i) => i.role === "reload")).toBe(true);
    hiddenMenu(false);
    expect(view().some((i) => i.role === "toggleDevTools")).toBe(false);
  });

  it("zooms the window the shortcut came from, else the focused one, by steps", () => {
    hiddenMenu(false);
    const w = new h.FakeWindow();
    click("Zoom in", w);
    expect(w.zoom).toBe(1.1);
    click("Zoom in ", w);
    click("Zoom in  ", w);
    expect(w.zoom).toBe(1.5);
    click("Zoom out", w);
    click("Zoom out ", w);
    expect(w.zoom).toBe(1.1);
    click("Actual size ", w);
    expect(w.zoom).toBe(1);
    const focused = new h.FakeWindow();
    h.focused = focused;
    click("Zoom out", {});
    expect(focused.zoom).toBe(0.9);
    click("Actual size", undefined);
    expect(focused.zoom).toBe(1);
    h.focused = null;
    expect(() => click("Zoom in", undefined)).not.toThrow();
  });
});
