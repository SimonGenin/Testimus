import { describe, expect, it } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { applyJobEvent } from "../../../../src/ui/lib/data/events.ts";
import {
  childSummary,
  dayLabel,
  failedStep,
  groupRepeats,
  jobTree,
  logByStep,
  problemText,
  processLabel,
  sections,
  subjectLabel,
} from "../../../../src/ui/lib/jobs.ts";

const job = (o: Partial<Job> & { id: string }): Job => ({
  kind: "check",
  subject: "tests",
  status: "done",
  startedAt: "2026-11-03T10:00:00Z",
  ...o,
});

describe("the job tree", () => {
  it("puts children under their parent, follow-ups under their origin, and keeps the rest as roots", () => {
    const list = [
      job({ id: "c2", parentId: "p", startedAt: "2026-11-03T10:00:02Z" }),
      job({ id: "c1", parentId: "p", startedAt: "2026-11-03T10:00:01Z" }),
      job({ id: "t", kind: "actions.triage", cause: { jobId: "f", why: "after-failure" } }),
      job({ id: "orphan", parentId: "gone" }),
      job({ id: "p", kind: "generate" }),
      job({ id: "f", kind: "rag-index", status: "failed" }),
    ];
    const roots = jobTree(list);
    expect(roots.map((r) => r.job.id)).toEqual(["orphan", "p", "f"]);
    expect(roots[1].children.map((c) => c.job.id)).toEqual(["c1", "c2"]);
    expect(roots[2].after.map((c) => c.job.id)).toEqual(["t"]);
    expect(childSummary(roots[1])).toBe("2 of 2 done");
    expect(childSummary(roots[0])).toBe("");
  });

  it("groups the same job run one after another, never a running one or one with jobs under it", () => {
    const roots = jobTree([
      job({ id: "a" }),
      job({ id: "b" }),
      job({ id: "c" }),
      job({ id: "r", status: "running" }),
      job({ id: "d" }),
      job({ id: "e", subject: "other" }),
    ]);
    const g = groupRepeats(roots);
    expect(g.map((n) => [n.job.id, n.repeats.map((j) => j.id)])).toEqual([
      ["a", ["b", "c"]],
      ["r", []],
      ["d", []],
      ["e", []],
    ]);
    expect(groupRepeats(roots)[0].repeats).toHaveLength(2);
    expect(roots[0].repeats).toEqual([]);
  });

  it("cuts the list into running first, then by day", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const roots = jobTree([
      job({ id: "old", startedAt: "2026-10-20T10:00:00Z" }),
      job({ id: "y", startedAt: "2026-11-02T10:00:00Z" }),
      job({ id: "run", status: "running" }),
      job({ id: "today" }),
    ]);
    expect(sections(roots, now).map((s) => [s.title, s.nodes.map((n) => n.job.id)])).toEqual([
      ["Running", ["run"]],
      [dayLabel("2026-10-20T10:00:00Z", now), ["old"]],
      ["Yesterday", ["y"]],
      ["Today", ["today"]],
    ]);
    expect(dayLabel("not a date")).toBe("Earlier");
  });
});

describe("readable words", () => {
  it("says what a subject means", () => {
    const byId = new Map([
      ["rag-index-054d21b9", job({ id: "rag-index-054d21b9", kind: "rag-index", subject: "index" })],
    ]);
    expect(subjectLabel(job({ id: "a", subject: "index" }), byId)).toBe("All documents");
    expect(subjectLabel(job({ id: "a", subject: "rag-index-054d21b9" }), byId)).toBe("Index documents · All documents");
    expect(subjectLabel(job({ id: "a", subject: "check-11111111" }), byId)).toBe("A past job");
    expect(subjectLabel(job({ id: "a", subject: "/Users/me/Downloads/spec.pdf" }), byId)).toBe("spec.pdf");
    expect(subjectLabel(job({ id: "a", subject: "C:\\docs\\a.docx" }), byId)).toBe("a.docx");
    expect(subjectLabel(job({ id: "a", subject: "{}" }), byId)).toBe("");
    expect(processLabel("Claude · generate 2/3")).toBe("Claude · write a test");
    expect(processLabel("Claude · generate")).toBe("Claude · read and write");
  });

  it("says an error three ways, known ones in plain words, and counts the repeats", () => {
    const raw = "Error: Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'";
    const failed = job({
      id: "f",
      status: "failed",
      error: raw,
      steps: [
        { id: "a", label: "A", status: "done" },
        { id: "b", label: "Embed", status: "failed" },
      ],
    });
    const log = (m: string): JobEvent => ({ jobId: "f", at: "x", type: "log", level: "error", message: m });
    const first = "Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'";
    const p = problemText(failed, [log(first), log(first), log("other")]);
    expect(p).toMatchObject({ what: "The search runtime is missing on this machine", detail: raw, repeated: 2 });
    expect(failedStep(failed)?.label).toBe("Embed");
    expect(problemText(job({ id: "x", status: "failed", error: "Something odd\nat line" })).what).toBe("Something odd");
    expect(problemText(job({ id: "x", status: "failed" })).what).toBe("The job failed.");
    expect(problemText(job({ id: "x", status: "failed", interrupted: true })).what).toMatch(/app stopped/);
  });
});

describe("the log cut by step", () => {
  it("puts each line under the step its event names", () => {
    const steps = [
      { id: "a", label: "A", status: "done" as const },
      { id: "b", label: "B", status: "done" as const },
    ];
    const ev: JobEvent[] = [
      { jobId: "j", at: "1", type: "log", level: "info", message: "before" },
      { jobId: "j", at: "2", type: "progress", message: "in a", step: "a" },
      { jobId: "j", at: "3", type: "progress", message: "in a", step: "a" },
      { jobId: "j", at: "4", type: "log", level: "warn", message: "in b", step: "b" },
      { jobId: "j", at: "5", type: "steps", steps },
    ];
    expect(logByStep(ev, steps).map((p) => [p.step?.id ?? "", p.lines.map((l) => l.text)])).toEqual([
      ["", ["before"]],
      ["a", ["in a"]],
      ["b", ["in b"]],
    ]);
  });
});

describe("following the events", () => {
  it("adds, replaces and patches the listed jobs", () => {
    let list: Job[] = [job({ id: "a", status: "running", steps: [{ id: "s", label: "S", status: "running" }] })];
    list = applyJobEvent(list, { jobId: "b", at: "x", type: "status", job: job({ id: "b" }) });
    expect(list.map((j) => j.id)).toEqual(["b", "a"]);
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "progress", message: "m", done: 1, total: 4, step: "s" });
    expect(list[1]).toMatchObject({ message: "m", progress: { done: 1, total: 4 } });
    expect(list[1].steps?.[0]).toMatchObject({ done: 1, total: 4, message: "m" });
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "progress", message: "n", step: "s" });
    expect(list[1].steps?.[0]).toMatchObject({ done: 1, message: "n" });
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "steps", steps: [] });
    expect(list[1].steps).toEqual([]);
    const proc = { id: "p1", label: "L", command: "c", startedAt: "x" };
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "process", process: proc });
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "process", process: { ...proc, exit: 0 } });
    expect(list[1].processes).toEqual([{ ...proc, exit: 0 }]);
    list = applyJobEvent(list, { jobId: "a", at: "x", type: "status", job: job({ id: "a", status: "done" }) });
    expect(list[1].status).toBe("done");
    expect(applyJobEvent(list, { jobId: "a", at: "x", type: "changed", paths: [] })).toBe(list);
  });
});
