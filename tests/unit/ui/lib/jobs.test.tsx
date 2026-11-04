// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { clock, duration, KIND, kindLabel, logLines, percent, resultLine } from "../../../../src/ui/lib/jobs.ts";
import { fakeNet, job } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";

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
