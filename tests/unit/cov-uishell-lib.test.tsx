// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck, Job, JobEvent } from "../../src/core/types.ts";
import { ApiError, setProject } from "../../src/ui/api.ts";
import { useApp } from "../../src/ui/lib/app.ts";
import {
  openExternal,
  openProject,
  pathOf,
  pickFiles,
  pickFolder,
  reveal,
  taskbarFraction,
  tracked,
} from "../../src/ui/lib/desktop.ts";
import { resetDoctor, runDoctor, useDoctor, worst } from "../../src/ui/lib/doctor.ts";
import { flushEditor, setFlusher } from "../../src/ui/lib/editorBus.ts";
import { DEFAULT_LAYOUT, fieldViews, parseSourceRef, sourceLabel } from "../../src/ui/lib/fields.ts";
import { cx, initials, message, plural, relTime } from "../../src/ui/lib/format.ts";
import { clock, duration, KIND, kindLabel, logLines, percent, resultLine } from "../../src/ui/lib/jobs.ts";
import { addedSteps } from "../../src/ui/lib/marks.ts";
import { editedAfterRun, revertRun } from "../../src/ui/lib/revert.ts";
import {
  applyTheme,
  nextTheme,
  readPref,
  readSession,
  readString,
  readTheme,
  setThemeEverywhere,
  writePref,
  writeSession,
} from "../../src/ui/lib/theme.ts";
import { closeToast, errorToast, type Toast, toast, useToasts } from "../../src/ui/lib/toast.ts";
import { callsOf, Fail, fakeNet, job, net } from "./cov-uishell-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";
import { fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("format", () => {
  it("formats messages, classes, plurals and initials", () => {
    expect(message(new Error("boom"))).toBe("boom");
    expect(message(42)).toBe("42");
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(plural(1, "test")).toBe("1 test");
    expect(plural(2, "test")).toBe("2 tests");
    expect(initials("RATP Sosie Ligne")).toBe("RS");
    expect(initials("   ")).toBe("?");
  });

  it("says a time relative to now in the right unit", () => {
    const now = Date.now();
    expect(relTime(now - 10_000)).toMatch(/s/);
    expect(relTime(now - 5 * 60_000)).toMatch(/5\s?m/);
    expect(relTime(now - 3 * 3_600_000)).toMatch(/3\s?h/);
    expect(relTime(now - 3 * 86_400_000)).toMatch(/3\s?d/);
  });
});

describe("jobs", () => {
  const at = "2026-11-02T10:00:00.000Z";

  it("labels kinds and measures durations", () => {
    expect(kindLabel("generate")).toBe(KIND.generate);
    expect(kindLabel("mystery")).toBe("mystery");
    expect(duration({ startedAt: at, endedAt: "2026-11-02T10:01:05.000Z" })).toBe("1:05");
    expect(duration({ startedAt: at, endedAt: "2026-11-02T12:03:04.000Z" })).toBe("2:03:04");
    expect(duration({ startedAt: at }, Date.parse(at) - 5000)).toBe("0:00");
    expect(clock("nope")).toBe("");
    expect(clock(at)).toMatch(/\d\d:\d\d:\d\d/);
  });

  it("sums up how a job ended", () => {
    const j = (o: Partial<Job>) => job({ status: "done", ...o });
    expect(resultLine(job())).toBe("Running");
    expect(resultLine(j({ status: "cancelled" }))).toBe("Cancelled");
    expect(resultLine(j({ status: "failed" }))).toBe("Failed");
    expect(resultLine(j({ status: "failed", error: `${"x".repeat(100)}\nmore` }))).toBe(`Failed · ${"x".repeat(80)}`);
    expect(resultLine(j({ result: { tests: ["a", "b"] } }))).toBe("Done · 2 tests written");
    expect(resultLine(j({ result: null }))).toBe("Done");
    expect(resultLine(j({ kind: "check", result: { tests: [{ errors: 1 }, { warnings: 0 }, {}] } }))).toBe(
      "Done · 1 with findings",
    );
    expect(resultLine(j({ kind: "check", result: {} }))).toBe("Done");
    expect(resultLine(j({ kind: "fix", result: { changedSteps: [1] } }))).toBe("Done · 1 step changed");
    expect(resultLine(j({ kind: "pull", result: { pulled: [] } }))).toBe("Done · 0 tests pulled");
    expect(resultLine(j({ kind: "rag-index", result: { chunks: 12 } }))).toBe("Done · 12 passages");
    expect(resultLine(j({ kind: "push", result: { ok: false } }))).toBe("Stopped on a Jira error");
    expect(resultLine(j({ kind: "push", result: { ok: true } }))).toBe("Done");
  });

  it("turns events into log lines", () => {
    const e = (o: Record<string, unknown>) => ({ jobId: "j1", at, ...o }) as JobEvent;
    const lines = logLines([
      e({ type: "progress", message: "Reading" }),
      e({ type: "progress", message: "Reading" }),
      e({ type: "log", level: "warn", message: "Slow" }),
      e({ type: "claude", event: { type: "tool", name: "Read", input: '{"file_path":"a.md"}' } }),
      e({ type: "claude", event: { type: "text", text: "hi" } }),
      e({ type: "claude", event: { type: "result", ok: true, text: "", durationMs: 1 } }),
      e({ type: "claude", event: { type: "result", ok: false, text: "limit reached", durationMs: 1 } }),
      e({ type: "status", job: job() }),
      e({ type: "status", job: job({ status: "failed" }) }),
      e({ type: "status", job: job({ status: "cancelled" }) }),
      e({ type: "status", job: job({ status: "done" }) }),
    ]);
    expect(lines.map((l) => [l.text, l.level])).toEqual([
      ["Reading", "info"],
      ["Slow", "warn"],
      ["Read a.md", "info"],
      ["Claude finished", "info"],
      ["Claude stopped: limit reached", "info"],
      ["Failed", "error"],
      ["Cancelled", "warn"],
      ["Done", "info"],
    ]);
  });

  it("computes a percentage only with a total", () => {
    expect(percent(job())).toBeNull();
    expect(percent(job({ progress: { done: 1, total: 0 } }))).toBeNull();
    expect(percent(job({ progress: { done: 1, total: 3 } }))).toBe(33);
  });
});

describe("toasts", () => {
  const clear = (list: Toast[]) => {
    for (const t of list) closeToast(t.id, true);
  };

  it("expires info toasts after six seconds and keeps errors until dismissed", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());
    const expired = vi.fn();
    const closed = vi.fn();
    act(() => {
      toast({ kind: "info", title: "Saved", onExpire: expired });
      toast({ kind: "error", title: "Broken", onExpire: closed });
    });
    expect(result.current.map((t) => t.title)).toEqual(["Saved", "Broken"]);
    act(() => vi.advanceTimersByTime(6000));
    expect(expired).toHaveBeenCalledTimes(1);
    expect(result.current.map((t) => t.title)).toEqual(["Broken"]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toHaveLength(1);
    act(() => closeToast(result.current[0].id));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it("keeps the last three, expiring the ones it drops", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());
    const dropped = vi.fn();
    act(() => {
      toast({ kind: "ok", title: "1", onExpire: dropped });
      toast({ kind: "ok", title: "2" });
      toast({ kind: "ok", title: "3" });
      toast({ kind: "ok", title: "4", left: 2 });
    });
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(result.current.map((t) => t.title)).toEqual(["2", "3", "4"]);
    const undone = vi.fn();
    act(() => {
      const id = toast({ kind: "error", title: "kept", onExpire: undone });
      closeToast(id, true);
    });
    expect(undone).not.toHaveBeenCalled();
    act(() => clear(result.current));
  });

  it("puts the fix of an ApiError in the detail", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      errorToast(new ApiError("Jira 401", "check the token"));
      errorToast(new ApiError("plain"), "Push failed");
      errorToast("oops");
    });
    expect(result.current.map((t) => [t.title, t.detail])).toEqual([
      ["Something went wrong", "Jira 401 — check the token"],
      ["Push failed", "plain"],
      ["Something went wrong", "oops"],
    ]);
    act(() => clear(result.current));
  });
});

describe("theme and preferences", () => {
  it("reads, applies and cycles the theme", () => {
    expect(readTheme()).toBe("system");
    localStorage.setItem("testimus.theme", "purple");
    expect(readTheme()).toBe("system");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readTheme()).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(nextTheme("dark")).toBe("system");
    const seen = vi.fn();
    window.addEventListener("testimus:theme", (e) => seen((e as CustomEvent).detail));
    setThemeEverywhere("light");
    expect(seen).toHaveBeenCalledWith("light");
  });

  it("reads and writes preferences and session values", () => {
    expect(readPref("k", ["a", "b"] as const, "a")).toBe("a");
    writePref("k", "b");
    expect(readPref("k", ["a", "b"] as const, "a")).toBe("b");
    writePref("k", "z");
    expect(readPref("k", ["a", "b"] as const, "a")).toBe("a");
    expect(readString("missing")).toBe("");
    expect(readString("k")).toBe("z");
    expect(readSession("s")).toBe("");
    writeSession("s", "1");
    expect(readSession("s")).toBe("1");
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readTheme()).toBe("system");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("system");
    expect(readPref("k", ["a"] as const, "a")).toBe("a");
    writePref("k", "a");
    expect(readString("k")).toBe("");
    expect(readSession("k")).toBe("");
    writeSession("k", "v");
  });
});

describe("desktop helpers", () => {
  it("returns nothing without the bridge", async () => {
    expect(await pickFolder("t")).toBeNull();
    expect(await pickFiles("t", [], false)).toEqual([]);
    expect(pathOf(new File([], "a.docx"))).toBe("");
    await reveal("C:\\p");
    expect(openExternal("https://x")).toBe(false);
  });

  it("turns bridge failures into toasts", async () => {
    const d = fakeDesktop();
    const { result } = renderHook(() => useToasts());
    const titles = () => result.current.map((t) => t.title);
    const clear = () =>
      act(() => {
        for (const t of result.current) closeToast(t.id, true);
      });
    d.pickFolder.mockRejectedValueOnce(new Error("no dialog"));
    expect(await pickFolder("t")).toBeNull();
    d.pickFiles.mockRejectedValueOnce(new Error("no dialog"));
    expect(await pickFiles("t", [{ name: "Word", extensions: ["docx"] }], true)).toEqual([]);
    expect(titles()).toEqual(["Could not open the folder dialog", "Could not open the file dialog"]);
    clear();
    d.reveal.mockResolvedValueOnce(false);
    await reveal("C:gone");
    d.reveal.mockRejectedValueOnce(new Error("shell"));
    await reveal("C:p");
    d.openExternal.mockRejectedValueOnce(new Error("blocked"));
    expect(openExternal("https://x")).toBe(true);
    await vi.waitFor(() => expect(result.current.length).toBe(3));
    expect(titles()).toEqual([
      "Could not show it in Explorer",
      "Could not show it in Explorer",
      "Could not open the link",
    ]);
    clear();
    d.pathOf.mockReturnValueOnce("C:a.docx");
    expect(pathOf(new File([], "a.docx"))).toBe("C:a.docx");
  });

  it("opens a project and remembers it", async () => {
    net.routes["project.open"] = (i) => ({ dir: `${i.dir}\\` });
    const refreshInfo = vi.fn();
    const testsChanged = vi.fn();
    expect(await openProject({ refreshInfo, testsChanged }, "C:\\p")).toBe("C:\\p\\");
    expect(localStorage.getItem("testimus.project")).toBe("C:\\p\\");
    expect(refreshInfo).toHaveBeenCalled();
    expect(testsChanged).toHaveBeenCalled();
  });

  it("tracks progress for the taskbar", () => {
    expect(tracked({})).toEqual({ done: 0, total: 0 });
    expect(taskbarFraction([])).toBeNull();
    expect(
      taskbarFraction([
        { done: 5, total: 2 },
        { done: 0, total: 0 },
      ]),
    ).toBe(0.5);
  });
});

describe("doctor store", () => {
  const c = (id: string, state: DoctorCheck["state"]): DoctorCheck => ({ id, label: id, state, detail: "" });

  beforeEach(() => resetDoctor());

  it("rates the worst check", () => {
    expect(worst([])).toBe("ok");
    expect(worst([c("a", "ok"), c("b", "fail")])).toBe("fail");
    expect(worst([c("a", "warn")])).toBe("warn");
    expect(worst([c("a", "skip"), c("b", "skip")])).toBe("skip");
    expect(worst([c("a", "skip"), c("b", "ok")])).toBe("ok");
  });

  it("keeps the last real sign-in answer across a run without the probe", async () => {
    net.routes["system.doctor"] = (i) =>
      i.claude ? { checks: [c("claudeLogin", "ok")] } : [c("claudeLogin", "skip"), c("node", "skip")];
    const { result } = renderHook(() => useDoctor());
    await act(() => runDoctor(true));
    expect(callsOf("system.doctor")[0].input).toEqual({ claude: true });
    const merged = await act(() => runDoctor());
    expect(merged.map((x) => x.state)).toEqual(["ok", "skip"]);
    expect(result.current.at).toBeGreaterThan(0);
    resetDoctor();
    expect((await runDoctor()).map((x) => x.state)).toEqual(["skip", "skip"]);
    net.routes["system.doctor"] = () => null;
    expect(await runDoctor()).toEqual([]);
  });

  it("keeps the checks and says why when the run fails", async () => {
    net.routes["system.doctor"] = () => [c("node", "ok")];
    await runDoctor();
    net.routes["system.doctor"] = () => {
      throw new Fail("core down", 500);
    };
    const { result } = renderHook(() => useDoctor());
    expect(await act(() => runDoctor())).toEqual([c("node", "ok")]);
    expect(result.current.error).toBe("core down");
    expect(result.current.running).toBe(false);
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    await act(() => runDoctor());
    expect(result.current.error).toBe("offline");
  });
});

describe("fields, marks, revert, editor bus, app context", () => {
  it("orders the step fields, adding the step's own and showing hidden ones that hold text", () => {
    const x = layoutOf(DEFAULT_LAYOUT.fields, { order: ["Expected Result", "Gone"], hidden: ["Data"] });
    const folded = layoutOf(DEFAULT_LAYOUT.fields, { collapsed: ["Data"] });
    expect(fieldViews(folded).find((v) => v.name === "Data")).toEqual({ name: "Data", collapsed: true });
    expect(fieldViews(x).map((v) => v.name)).toEqual(["Expected Result", "Action"]);
    const step = { fields: { Data: "  x ", Exigence: "REQ-1" }, sources: [], images: [] };
    expect(fieldViews(x, step)).toEqual([
      { name: "Expected Result", collapsed: false },
      { name: "Action", collapsed: false },
      { name: "Data", collapsed: false },
      { name: "Exigence", collapsed: false },
    ]);
  });

  it("labels sources", () => {
    expect(sourceLabel({ docId: "D", anchor: "fig:3" })).toBe("D Figure 3");
    expect(sourceLabel({ docId: "D", anchor: "§1.2" })).toBe("D §1.2");
    expect(parseSourceRef('D#§1 "a quote"')).toEqual({ docId: "D", anchor: "§1", quote: "a quote" });
    expect(parseSourceRef("D#§1")).toEqual({ docId: "D", anchor: "§1", quote: "" });
    expect(parseSourceRef("no anchor")).toBeNull();
  });

  it("marks added steps only with a known before-count", () => {
    expect([...addedSteps([1, 4, 5], null)]).toEqual([]);
    expect([...addedSteps([1, 4, 5], 3)]).toEqual([4, 5]);
  });

  it("reverts a run, with force when asked", async () => {
    net.routes["claude.revert"] = (i) => ({ reverted: [String(i.runId)] });
    await revertRun("r1");
    await revertRun("r2", true);
    expect(callsOf("claude.revert").map((c) => c.input)).toEqual([{ runId: "r1" }, { runId: "r2", force: true }]);
    expect(editedAfterRun(new Error("The test changed after the Claude run"))).toBe(true);
    expect(editedAfterRun("other")).toBe(false);
  });

  it("flushes the editor only when one is registered", async () => {
    await flushEditor();
    const fn = vi.fn(async () => {});
    setFlusher(fn);
    await flushEditor();
    expect(fn).toHaveBeenCalled();
    setFlusher(null);
  });

  it("refuses useApp outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useApp())).toThrow("useApp outside AppContext");
  });
});
