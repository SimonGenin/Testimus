import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, Menu: {}, shell: { openExternal: vi.fn() } }));

const {
  clampState,
  clampZoom,
  DEFAULT_SIZE,
  navigationAllowed,
  nextZoom,
  openAction,
  permissionAllowed,
  readState,
  writeState,
  LOCKED_PREFERENCES,
} = await import("../../../src/desktop/window.ts");

const ORIGIN = "http://127.0.0.1:53211";
const laptop = { x: 0, y: 0, width: 1536, height: 816 };
const second = { x: 1536, y: 0, width: 1920, height: 1040 };

describe("window state", () => {
  it("keeps a window that is on a visible display", () => {
    const s = clampState(
      { x: 1700, y: 100, width: 1400, height: 900, maximized: true, zoom: 1.25 },
      [laptop, second],
      laptop,
    );
    expect(s).toEqual({ x: 1700, y: 100, width: 1400, height: 900, maximized: true, zoom: 1.25 });
  });

  it("brings back a window left on a screen that is gone (laptop undocked)", () => {
    const s = clampState({ x: 1700, y: 100, width: 1400, height: 900 }, [laptop], laptop);
    expect(s.x).toBeGreaterThanOrEqual(laptop.x);
    expect(s.x + s.width).toBeLessThanOrEqual(laptop.x + laptop.width);
    expect(s.y + s.height).toBeLessThanOrEqual(laptop.y + laptop.height);
    expect(s.width).toBe(1400);
    expect(s.height).toBe(laptop.height);
  });

  it("brings back a window whose title bar is above the screen", () => {
    const s = clampState({ x: 100, y: -500, width: 1200, height: 900 }, [laptop], laptop);
    expect(s.y).toBeGreaterThanOrEqual(0);
  });

  it("brings back a window that only shows a sliver", () => {
    const s = clampState({ x: 1500, y: 100, width: 1000, height: 700 }, [laptop], laptop);
    expect(s.x).toBe(Math.round((1536 - 1000) / 2));
  });

  it("centres the default size on first start, never bigger than the screen", () => {
    const s = clampState({}, [laptop], laptop);
    expect(s.width).toBe(DEFAULT_SIZE.width);
    expect(s.height).toBe(laptop.height);
    expect(s).toMatchObject({ x: Math.round((1536 - DEFAULT_SIZE.width) / 2), y: 0, maximized: false, zoom: 1 });
  });

  it("keeps a sane zoom", () => {
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.5, 0)).toBe(1);
    expect(nextZoom(2, 1)).toBe(2);
    expect(nextZoom(1.05, 1)).toBe(1.1);
  });

  it("reads back what it wrote and ignores a broken file", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-desktop-"));
    const file = join(dir, "window.json");
    writeState({ x: 1, y: 2, width: 1000, height: 700, maximized: false, zoom: 1.5 }, file);
    expect(readState(file)).toEqual({ x: 1, y: 2, width: 1000, height: 700, maximized: false, zoom: 1.5 });
    writeFileSync(file, "{oops");
    expect(readState(file)).toEqual({});
    writeFileSync(file, '{"x":"1","width":null,"maximized":"yes"}');
    expect(readState(file)).toEqual({});
  });
});

describe("navigation and permissions", () => {
  it("lets the window navigate on the core origin only", () => {
    expect(navigationAllowed(`${ORIGIN}/#/review`, ORIGIN)).toBe(true);
    expect(navigationAllowed("http://127.0.0.1:53212/", ORIGIN)).toBe(false);
    expect(navigationAllowed("http://localhost:53211/", ORIGIN)).toBe(false);
    expect(navigationAllowed("https://transurb.atlassian.net/", ORIGIN)).toBe(false);
    expect(navigationAllowed("file:///C:/Windows/win.ini", ORIGIN)).toBe(false);
    expect(navigationAllowed(`${ORIGIN}/`, null)).toBe(false);
    expect(navigationAllowed("javascript:alert(1)", ORIGIN)).toBe(false);
  });

  it("sends https links to the browser, opens project files in a child window, refuses the rest", () => {
    expect(openAction("https://id.atlassian.com/manage-profile/security/api-tokens", ORIGIN)).toBe("external");
    expect(openAction("https://user:pw@example.com/", ORIGIN)).toBe("deny");
    expect(openAction(`${ORIGIN}/files/tests/a/img.png`, ORIGIN)).toBe("child");
    expect(openAction(`${ORIGIN}/api/system/version`, ORIGIN)).toBe("deny");
    expect(openAction("http://127.0.0.1:9/files/x.png", ORIGIN)).toBe("deny");
    expect(openAction("http://example.com/", ORIGIN)).toBe("deny");
    expect(openAction("file:///C:/x.png", ORIGIN)).toBe("deny");
    expect(openAction("mailto:a@b.c", ORIGIN)).toBe("deny");
    expect(openAction("::", ORIGIN)).toBe("deny");
  });

  it("grants only the sanitized clipboard write", () => {
    expect(permissionAllowed("clipboard-sanitized-write")).toBe(true);
    for (const p of [
      "clipboard-read",
      "media",
      "geolocation",
      "notifications",
      "openExternal",
      "fullscreen",
      "fileSystem",
    ])
      expect(permissionAllowed(p)).toBe(false);
  });

  it("locks the renderer down", () => {
    expect(LOCKED_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    });
  });
});
