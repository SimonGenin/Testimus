import { describe, expect, it } from "vitest";
import type { CheckFile, Test } from "../../../../src/core/types.ts";
import { stepOpened } from "../../../../src/ui/screens/review/sources.ts";

const test = (steps: Test["steps"]) => ({ steps }) as Test;
const step = (sources: Test["steps"][number]["sources"] = []) => ({ fields: {}, sources, images: [] });
const check = (findings: CheckFile["findings"]): CheckFile => ({ at: "", testHash: "", findings });

describe("the source panel following ↑/↓", () => {
  it("opens a step's own first source, else the passage of a finding on that step, else nothing", () => {
    const own = { docId: "D", anchor: "§1", quote: "a" };
    const t = test([step([own]), step(), step()]);
    const c = check([
      { step: 3, kind: "source-missing", severity: "warning", message: "no source", sources: [] },
      { step: 2, kind: "source-missing", severity: "error", message: "wrong", sources: ['D#§2 "b"'] },
    ]);
    expect(stepOpened(t, c, 1)).toMatchObject({ source: own, step: 1 });
    expect(stepOpened(t, c, 2)).toMatchObject({
      source: { docId: "D", anchor: "§2", quote: "b" },
      step: 2,
      finding: 1,
    });
    expect(stepOpened(t, c, 3)).toBeNull();
    expect(stepOpened(t, null, 3)).toBeNull();
  });
});
