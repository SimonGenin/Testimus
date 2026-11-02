import type { Step, Test } from "../../core/types.ts";

export type StepMark = "same" | "modified" | "new";
export type Gone = { at: number; step: Step };

const filled = (f: Record<string, string>) =>
  JSON.stringify(
    Object.entries(f)
      .filter(([, v]) => v.trim())
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export const sameStep = (a: Step, b: Step) =>
  filled(a.fields) === filled(b.fields) &&
  a.images.map((i) => i.file).join("|") === b.images.map((i) => i.file).join("|") &&
  JSON.stringify(a.sources) === JSON.stringify(b.sources);

// ponytail: an Xray step id is the only identity a step has — matching goes by id, so moving a step never
// marks it modified; a snapshot step no local step claims any more is « gone », placed after the last
// local step that still matched one of the snapshot steps before it
export function diffLocal(local: Step[], base: Step[]): { marks: StepMark[]; gone: Gone[] } {
  const marks = local.map<StepMark>((s) => {
    const b = s.id ? base.find((x) => x.id === s.id) : undefined;
    return !b ? "new" : sameStep(s, b) ? "same" : "modified";
  });
  const gone: Gone[] = [];
  let at = -1;
  for (const b of base) {
    const i = b.id ? local.findIndex((s) => s.id === b.id) : -1;
    if (i >= 0) at = i;
    else gone.push({ at, step: b });
  }
  return { marks, gone };
}

export function restoreStep(local: Test, base: Step, gone: Gone | null): Test {
  const steps = local.steps.slice();
  const i = base.id ? steps.findIndex((s) => s.id === base.id) : -1;
  if (i >= 0) steps[i] = structuredClone(base);
  else steps.splice(gone ? gone.at + 1 : steps.length, 0, structuredClone(base));
  return { ...local, steps };
}

export function lossOf(local: Test, base: Test): { modified: number; added: number; deleted: number } {
  const { marks, gone } = diffLocal(local.steps, base.steps);
  return {
    modified: marks.filter((m) => m === "modified").length,
    added: marks.filter((m) => m === "new").length,
    deleted: gone.length,
  };
}

const header = (t: Test) =>
  JSON.stringify([
    t.summary,
    t.folder,
    t.labels,
    t.description.trim(),
    [...t.covers].sort(),
    [...t.preconditions].sort(),
    t.clonedFrom ?? "",
  ]);

// ponytail: the editor's own answer to « is this test dirty? » while the list's flag lags the last save —
// the same content the core compares, step by step
export const differs = (local: Test, base: Test) =>
  header(local) !== header(base) ||
  local.steps.length !== base.steps.length ||
  local.steps.some((s, i) => s.id !== base.steps[i].id || !sameStep(s, base.steps[i]));
