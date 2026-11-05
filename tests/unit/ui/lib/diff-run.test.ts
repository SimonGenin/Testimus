import { describe, expect, it } from "vitest";
import type { Step, Test } from "../../../../src/core/types.ts";
import { diffRun, restoreRunStep } from "../../../../src/ui/lib/diff.ts";

const s = (action: string, id?: string): Step => ({
  ...(id ? { id } : {}),
  fields: { Action: action },
  images: [],
  sources: [],
});
const acts = (steps: (Step | undefined)[]) => steps.map((x) => x?.fields.Action);

describe("diffRun: the steps against the test before a Claude run", () => {
  it("matches steps without ids by content: an inserted step is new, the ones after it stay the same", () => {
    const d = diffRun([s("a"), s("new"), s("b"), s("c")], [s("a"), s("b"), s("c")]);
    expect(d.marks).toEqual(["same", "new", "same", "same"]);
    expect(d.gone).toEqual([]);
  });

  it("a changed step is modified and keeps the step it was", () => {
    const d = diffRun([s("a"), s("B!"), s("c")], [s("a"), s("b"), s("c")]);
    expect(d.marks).toEqual(["same", "modified", "same"]);
    expect(acts(d.was)).toEqual([undefined, "b", undefined]);
  });

  it("a deleted step is gone, placed after the last step before it (or on top)", () => {
    expect(diffRun([s("a"), s("c")], [s("a"), s("b"), s("c")]).gone).toEqual([{ at: 0, step: s("b") }]);
    expect(diffRun([s("b")], [s("a"), s("b")]).gone).toEqual([{ at: -1, step: s("a") }]);
    const d = diffRun([s("A!"), s("c")], [s("a"), s("b"), s("c")]);
    expect(d.marks).toEqual(["modified", "same"]);
    expect(d.gone).toEqual([{ at: 0, step: s("b") }]);
  });

  it("two steps of the same content but other Xray ids are not the same step", () => {
    const d = diffRun([s("a", "2")], [s("a", "1")]);
    expect(d.marks).toEqual(["modified"]);
    expect(diffRun([s("a", "1")], [s("a")]).marks).toEqual(["same"]);
  });

  it("restoreRunStep puts a step back in its place, or a deleted one where it was", () => {
    const t = { steps: [s("a"), s("X")] } as Test;
    expect(acts(restoreRunStep(t, s("b"), null, 2).steps)).toEqual(["a", "b"]);
    expect(acts(restoreRunStep(t, s("z"), { at: -1, step: s("z") }, 0).steps)).toEqual(["z", "a", "X"]);
    expect(acts(t.steps)).toEqual(["a", "X"]);
  });
});
