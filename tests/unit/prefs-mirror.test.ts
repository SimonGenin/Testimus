// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mirrorPrefs, restorePrefs } from "../../src/ui/lib/prefsMirror.ts";

let calls: { name: string; input: Record<string, unknown> }[] = [];
let saved: Record<string, string> | undefined;

beforeEach(() => {
  calls = [];
  saved = undefined;
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      if (name === "system.settings") return new Response(JSON.stringify({ ui: saved }), { status: 200 });
      if (name === "system.set") {
        saved = input.ui as Record<string, string>;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.testimusDesktop;
});

const asDesktop = () => {
  window.testimusDesktop = {} as never;
};

describe("page preferences kept in settings.json (desktop app)", () => {
  it("a new origin (the core changed port) gets the saved preferences back, once", async () => {
    asDesktop();
    saved = { "testimus.theme": "dark", "testimus.sidebarWidth": "300", other: "x" };
    expect(await restorePrefs()).toBe(true);
    expect(localStorage.getItem("testimus.theme")).toBe("dark");
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("300");
    expect(localStorage.getItem("other")).toBeNull();
    expect(await restorePrefs()).toBe(false);
  });

  it("copies every change there a few seconds later, and when the window hides", async () => {
    asDesktop();
    vi.useFakeTimers();
    const stop = mirrorPrefs(1000);
    localStorage.setItem("testimus.editorWidth", "900");
    localStorage.setItem("unrelated", "1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual({ "testimus.editorWidth": "900" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.filter((c) => c.name === "system.set")).toHaveLength(1);
    localStorage.setItem("testimus.theme", "light");
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual({ "testimus.editorWidth": "900", "testimus.theme": "light" });
    stop();
  });

  it("does nothing in the browser, where the origin does not move", async () => {
    saved = { "testimus.theme": "dark" };
    expect(await restorePrefs()).toBe(false);
    const stop = mirrorPrefs(10);
    stop();
    expect(calls).toEqual([]);
  });
});
