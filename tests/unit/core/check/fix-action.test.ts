import { describe, expect, it } from "vitest";
import { proposeFix } from "../../../../src/core/claude/check.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { listActions } from "../../../../src/core/lib/actions.ts";
import { recordSemantic, runMechanical } from "../../../../src/core/lib/check.ts";
import type { Finding } from "../../../../src/core/types.ts";
import { verdictsOf } from "../../helpers/fake-check.ts";
import { checked, dir, fake, seen } from "../claude/run-fakes.ts";

const ID = "LFRPS12-1420";
const NAME = "Sectionneur sans TK — menu contextuel et propriétés";
const BY = { runId: "run-1", model: "sonnet", effort: "medium" as const };
const NO_SOURCE = 'Step 5 has no source for its expected result: add a ### Sources line docId#anchor "exact quote".';

type Found = Omit<Finding, "pass">;
const found = (f: Partial<Found> & Pick<Found, "kind" | "severity" | "message">): Found => ({ sources: [], ...f });

describe("the fix action of a test is built from its check", () => {
  it("one action: what the mechanical pass found and what the check gave a fix for, each step once in the plan", () => {
    recordSemantic(dir, ID, [
      found({ step: 2, kind: "unsupported", severity: "error", message: "M2", fix: "Dire que le menu s'ouvre." }),
      found({ step: 3, kind: "vague-result", severity: "warning", message: "Only the team can say." }),
      found({ kind: "case-missing", severity: "info", message: "A case nobody asked for.", fix: "Add it." }),
    ]);
    proposeFix(dir, ID, BY);
    const [a, ...more] = listActions(dir);
    expect(more).toEqual([]);
    expect(a).toMatchObject({
      title: `Fix 1 error in « ${NAME} »`,
      where: `test:${ID}`,
      scope: { kind: "test", testId: ID },
      problem: `unsupported (step 2): M2 · source-missing (step 5): ${NO_SOURCE}`,
      plan: [
        "Step 2: Dire que le menu s'ouvre.",
        NO_SOURCE,
        "Run check_run on the test: none of these findings is left",
      ],
      suggest: { model: "sonnet", effort: "high" },
      proposedBy: { run: "check", runId: "run-1", model: "sonnet", effort: "medium" },
      state: "open",
    });
  });

  it("warnings alone are counted as warnings and ask for less effort; the same check proposed again is the same action", () => {
    runMechanical(dir, ID);
    proposeFix(dir, ID, BY);
    const first = listActions(dir);
    expect(first.map((a) => [a.title, a.suggest])).toEqual([
      [`Fix 1 warning in « ${NAME} »`, { model: "sonnet", effort: "medium" }],
    ]);
    proposeFix(dir, ID, { ...BY, runId: "run-2" });
    expect(listActions(dir).map((a) => a.id)).toEqual(first.map((a) => a.id));
  });

  it("nothing to fix, nothing proposed: a finding without a fix, an info, a test that is gone", () => {
    recordSemantic(dir, "LFRPS12-1398", [
      found({ step: 1, kind: "vague-result", severity: "warning", message: "Only the team can say." }),
      found({ kind: "case-missing", severity: "info", message: "A case.", fix: "Add it." }),
    ]);
    const logs: string[] = [];
    proposeFix(dir, "LFRPS12-1398", BY, (_level, m) => logs.push(m));
    proposeFix(dir, "local-00000000", BY, (_level, m) => logs.push(m));
    expect(listActions(dir)).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("a long test name is cut so the title stays within 80 characters", async () => {
    const long = "local-3f9a12c0";
    const summary = "Sectionneur avec TK — manœuvre régulière depuis le poste de commande centralisé de la ligne 92";
    await invoke("tests.edit", { id: long, summary }, { project: dir });
    recordSemantic(dir, long, [
      found({ step: 2, kind: "vague-result", severity: "warning", message: "M", fix: "Lister les commandes." }),
    ]);
    proposeFix(dir, long, BY);
    const [a] = listActions(dir);
    expect(a.title.length).toBeLessThanOrEqual(80);
    expect(a.title).toMatch(/^Fix 1 warning in « Sectionneur avec TK — manœuvre régulière .+… »$/);
  });
});

describe("check.run leaves the fix action itself", () => {
  it("a test whose check gave a fix gets its action from the run that checked it; a clean one gets none", async () => {
    fake(() =>
      checked({
        findings: (id) =>
          id === ID
            ? [
                found({
                  step: 2,
                  kind: "unsupported",
                  severity: "error",
                  message: "M2",
                  fix: "Dire que le menu s'ouvre.",
                }),
              ]
            : [],
        steps: (id) =>
          verdictsOf(dir, id).map((v) => (id === ID && v.step === 2 ? { ...v, verdict: "unsupported" as const } : v)),
      }),
    );
    const out = (await invoke("check.run", { ids: [ID, "LFRPS12-1398"] }, { project: dir })) as { failed: string[] };
    expect(out.failed).toEqual([]);
    expect(seen).toHaveLength(1);
    const actions = listActions(dir);
    expect(actions.map((a) => [a.where, a.title])).toEqual([[`test:${ID}`, `Fix 1 error in « ${NAME} »`]]);
    expect(actions[0].proposedBy).toMatchObject({ run: "check", model: "sonnet", effort: "medium" });
    expect(actions[0].proposedBy.runId).toMatch(/^run-/);
  });
});
