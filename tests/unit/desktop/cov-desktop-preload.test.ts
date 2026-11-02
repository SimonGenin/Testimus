import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellPage, TestimusDesktop } from "../../../src/desktop/bridge-types.ts";

const h = vi.hoisted(() => ({
  role: null as unknown,
  exposed: {} as Record<string, unknown>,
  listeners: {} as Record<string, (event: unknown, ...args: unknown[]) => void>,
  invoke: vi.fn(async (..._args: unknown[]) => "answer"),
  sendSync: vi.fn((..._args: unknown[]) => h.role),
  getPathForFile: vi.fn((_f: unknown) => "D:\\docs\\a.docx"),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      h.exposed[key] = api;
    },
  },
  ipcRenderer: {
    invoke: h.invoke,
    sendSync: h.sendSync,
    on: (name: string, fn: (event: unknown, ...args: unknown[]) => void) => {
      h.listeners[name] = fn;
    },
  },
  webUtils: { getPathForFile: h.getPathForFile },
}));

const load = async (role: unknown) => {
  h.role = role;
  vi.resetModules();
  await import("../../../src/desktop/preload.ts");
};

beforeEach(() => {
  h.exposed = {};
  h.listeners = {};
  h.invoke.mockClear();
  h.sendSync.mockClear();
  h.getPathForFile.mockReset();
  h.getPathForFile.mockReturnValue("D:\\docs\\a.docx");
});

describe("preload for the app page", () => {
  it("asks its role once and exposes the desktop bridge only", async () => {
    await load("bridge");
    expect(h.sendSync).toHaveBeenCalledWith("testimus:hello");
    expect(Object.keys(h.exposed)).toEqual(["testimusDesktop"]);
  });

  it("forwards every call to its channel with its arguments", async () => {
    await load("bridge");
    const d = h.exposed.testimusDesktop as TestimusDesktop;
    expect(await d.version()).toBe("answer");
    await d.pickFolder({ title: "Open" });
    await d.pickFiles({ title: "Add", filters: [], multiple: true });
    await d.reveal("D:\\x");
    await d.openExternal("https://claude.ai/");
    await d.setProgress(0.5);
    await d.notify({ title: "t", body: "b" });
    await d.setAlwaysOnTop(true);
    expect(h.invoke.mock.calls).toEqual([
      ["testimus:version"],
      ["testimus:pickFolder", { title: "Open" }],
      ["testimus:pickFiles", { title: "Add", filters: [], multiple: true }],
      ["testimus:reveal", "D:\\x"],
      ["testimus:openExternal", "https://claude.ai/"],
      ["testimus:setProgress", 0.5],
      ["testimus:notify", { title: "t", body: "b" }],
      ["testimus:setAlwaysOnTop", true],
    ]);
  });

  it("gives a dropped file's path, or nothing", async () => {
    await load("bridge");
    const d = h.exposed.testimusDesktop as TestimusDesktop;
    const f = new File(["x"], "a.docx");
    expect(d.pathOf(f)).toBe("D:\\docs\\a.docx");
    expect(h.getPathForFile).toHaveBeenCalledWith(f);
    expect(d.pathOf({ name: "fake" } as unknown as File)).toBe("");
    h.getPathForFile.mockImplementation(() => {
      throw new Error("not a real file");
    });
    expect(d.pathOf(f)).toBe("");
  });

  it("delivers a folder from a second launch to every listener, keeping one for a late listener", async () => {
    await load("bridge");
    const d = h.exposed.testimusDesktop as TestimusDesktop;
    const send = h.listeners["testimus:open-project"];
    send({}, 42);
    send({}, "D:\\early");
    send({}, "D:\\later");
    const late = vi.fn();
    const off = d.onOpenProject(late);
    expect(late.mock.calls).toEqual([["D:\\later"]]);
    const other = vi.fn();
    d.onOpenProject(other);
    expect(other).not.toHaveBeenCalled();
    send({}, "D:\\now");
    expect(late).toHaveBeenLastCalledWith("D:\\now");
    expect(other).toHaveBeenLastCalledWith("D:\\now");
    off();
    send({}, "D:\\after");
    expect(late).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenLastCalledWith("D:\\after");
    const noop = d.onOpenProject("nope" as never);
    expect(noop()).toBeUndefined();
  });
});

describe("preload for the error page", () => {
  it("exposes the shell calls only", async () => {
    await load("shell");
    expect(Object.keys(h.exposed)).toEqual(["testimusShell"]);
    const s = h.exposed.testimusShell as ShellPage;
    await s.details();
    await s.restart();
    await s.openLogs();
    expect(h.invoke.mock.calls).toEqual([["testimus:details"], ["testimus:restart"], ["testimus:openLogs"]]);
  });
});

describe("preload for any other page", () => {
  it("exposes nothing", async () => {
    await load(null);
    expect(h.exposed).toEqual({});
    expect(h.listeners).toEqual({});
  });
});
