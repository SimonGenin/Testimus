import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ handle: {} as Record<string, (event: unknown, ...args: unknown[]) => unknown> }));

vi.mock("electron", () => ({
  dialog: {},
  ipcMain: {
    on: () => {},
    handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handle[name] = fn;
    },
  },
  Notification: class {},
  shell: {},
}));

const { checkArgs, registerBridge } = await import("../../../src/desktop/bridge.ts");
const { BRIDGE_CALLS } = await import("../../../src/desktop/bridge-types.ts");

const ORIGIN = "http://127.0.0.1:53999";
let top = false;
const win = {
  webContents: {},
  setAlwaysOnTop: vi.fn((on: boolean) => {
    top = on;
  }),
  isAlwaysOnTop: () => top,
};
registerBridge({
  window: () => win as never,
  origin: () => ORIGIN,
  shellPage: "file:///C:/x/pages/error.html",
  icon: "C:/x/pages/logo.png",
  version: { shell: "0.2.0", electron: "45.2.1", chrome: "140" },
  knownRoots: async () => [],
  details: () => ({ message: "", lines: [], logDir: "" }),
  restart: () => {},
  openLogs: () => {},
});
const page = (...args: unknown[]) =>
  h.handle["testimus:setAlwaysOnTop"](
    { sender: win.webContents, senderFrame: { parent: null, url: `${ORIGIN}/#/tests` } },
    ...args,
  );

describe("always on top", () => {
  it("is a bridge call that takes true or false only", () => {
    expect(BRIDGE_CALLS).toContain("setAlwaysOnTop");
    expect(checkArgs("setAlwaysOnTop", [true])).toEqual({ ok: true, value: true });
    expect(checkArgs("setAlwaysOnTop", [false])).toEqual({ ok: true, value: false });
    expect(checkArgs("setAlwaysOnTop", ["yes"]).ok).toBe(false);
    expect(checkArgs("setAlwaysOnTop", []).ok).toBe(false);
  });

  it("pins and unpins the window and answers its state", async () => {
    expect(await page(true)).toBe(true);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(await page(false)).toBe(false);
    await expect(Promise.resolve().then(() => page(1))).rejects.toThrow(/true or false/);
    await expect(
      Promise.resolve().then(() =>
        h.handle["testimus:setAlwaysOnTop"]({ sender: {}, senderFrame: { parent: null, url: `${ORIGIN}/` } }, true),
      ),
    ).rejects.toThrow(/refused for this page/);
  });
});
