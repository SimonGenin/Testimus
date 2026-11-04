// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { originLine, scopeWords } from "../../../../src/ui/lib/actions.ts";
import { cliLine } from "../../../../src/ui/lib/cli.ts";
import { useDraft } from "../../../../src/ui/lib/data/autosave.ts";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";
import { failedStep, resultLine } from "../../../../src/ui/lib/jobs.ts";
import { readPref, savedPrefs, writePref } from "../../../../src/ui/lib/prefs.ts";
import { mirrorPrefs, restorePrefs } from "../../../../src/ui/lib/prefsMirror.ts";

afterEach(cleanup);

describe("how an action names its scope and its age", () => {
  it("names a test, a set of tests and the whole project", () => {
    expect(scopeWords({ kind: "test", testId: "LFRPS12-1420" })).toBe("LFRPS12-1420 · whole test");
    expect(scopeWords({ kind: "tests", testIds: ["a", "b", "c"] })).toBe("3 tests");
    expect(scopeWords({ kind: "project" })).toBe("Whole project");
  });

  it("says just now, hours or days since it was proposed", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    const at = (iso: string) => originLine({ proposedBy: { run: "check", model: "", effort: "", at: iso } }, now);
    expect(at("2026-11-04T11:59:30Z")).toBe("Proposed by Claude · during the check · just now");
    expect(at("2026-11-04T09:00:00Z")).toBe("Proposed by Claude · during the check · 3 h ago");
    expect(at("2026-11-01T12:00:00Z")).toBe("Proposed by Claude · during the check · 3 d ago");
    expect(at("2026-11-05T12:00:00Z")).toBe("Proposed by Claude · during the check · just now");
  });
});

describe("the command line of a form", () => {
  it("leaves out the fields that are empty or off", () => {
    expect(cliLine("xray.push", { id: "LFRPS12-1420", dryRun: false, folder: undefined, note: null })).toBe(
      "testimus xray push --id LFRPS12-1420",
    );
  });
});

describe("a job's result line and failed step", () => {
  const job = (o: Partial<Job>) => ({ id: "j", kind: "generate", subject: "s", status: "done", ...o }) as Job;
  it("an interrupted job says so before anything else", () => {
    expect(resultLine(job({ status: "failed", interrupted: true, error: "boom" }))).toBe("Interrupted");
  });
  it("the step to show is the failed one, else the one that was running", () => {
    const steps = [
      { id: "a", label: "Read", status: "done" },
      { id: "b", label: "Write", status: "running" },
    ] as Job["steps"];
    expect(failedStep(job({ steps }))?.id).toBe("b");
    expect(failedStep(job({}))).toBeUndefined();
  });
});

describe("a draft without a key", () => {
  it("keeps nothing: typing and clearing do not change it", () => {
    const r = renderHook(() => useDraft(null, "start"));
    act(() => r.result.current[1]("typed"));
    expect(r.result.current[0]).toBe("start");
    act(() => r.result.current[2]());
    expect(r.result.current[0]).toBe("start");
  });
});

describe("preferences when the browser blocks its storage", () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => {
    spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
  });
  afterEach(() => spy?.mockRestore());

  it("reads the default, writes nothing and keeps nothing to mirror", () => {
    expect(readPref("theme")).toBe("system");
    writePref("theme", "dark");
    expect(readPref("theme")).toBe("system");
    expect(savedPrefs()).toEqual({});
  });
});

describe("the desktop mirror of the preferences", () => {
  let calls: string[] = [];
  let settings: () => Response = () => new Response("{}");
  beforeEach(() => {
    calls = [];
    localStorage.clear();
    window.testimusDesktop = {} as never;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
        calls.push(`${m?.[1]}.${m?.[2]}`);
        return m?.[2] === "settings" ? settings() : new Response("{}");
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete window.testimusDesktop;
  });

  it("puts nothing back when the settings cannot be read or hold no preference", async () => {
    settings = () => new Response(JSON.stringify({ message: "down" }), { status: 500 });
    expect(await restorePrefs(createQueryClient())).toBe(false);
    settings = () => new Response(JSON.stringify({ ui: {} }));
    expect(await restorePrefs(createQueryClient())).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("sends a change as soon as the window is hidden, and nothing while it stays visible", async () => {
    vi.useFakeTimers();
    const stop = mirrorPrefs(createQueryClient(), 60_000);
    localStorage.setItem("testimus.theme", "dark");
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).not.toContain("system.set");
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toContain("system.set");
    state.mockRestore();
    stop();
  });
});
