import type { CommandOutput } from "../../core/commands/index.ts";
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

/** the test before the Claude run that changed it, while that change stands (claude.before) */
export type ClaudeBefore = NonNullable<CommandOutput<"claude.before">>;

export type RunDiff = { marks: StepMark[]; was: (Step | undefined)[]; gone: Gone[] };

// ponytail: before a Claude run a step may have no Xray id (generated, or new since the last sync), so the steps match
// by content: the longest sequence of unchanged steps in order anchors the rest; between two anchors the steps pair by
// position (modified, with the step they were), the local ones left over are new and the old ones left over gone
export function diffRun(local: Step[], base: Step[]): RunDiff {
  const same = (a: Step, b: Step) => (!a.id || !b.id || a.id === b.id) && sameStep(a, b);
  const n = local.length;
  const m = base.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--)
    for (let b = m - 1; b >= 0; b--)
      lcs[a][b] = same(local[a], base[b]) ? lcs[a + 1][b + 1] + 1 : Math.max(lcs[a + 1][b], lcs[a][b + 1]);
  const out: RunDiff = { marks: [], was: [], gone: [] };
  let i = 0;
  let j = 0;
  const gap = (li: number, bj: number) => {
    for (let k = 0; k < li - i; k++) {
      const b = j + k < bj ? base[j + k] : undefined;
      out.marks.push(b ? "modified" : "new");
      out.was.push(b);
    }
    for (let k = j + (li - i); k < bj; k++) out.gone.push({ at: li - 1, step: base[k] });
  };
  let a = 0;
  let b = 0;
  while (a < n && b < m) {
    if (same(local[a], base[b])) {
      gap(a, b);
      out.marks.push("same");
      out.was.push(undefined);
      i = ++a;
      j = ++b;
    } else if (lcs[a + 1][b] >= lcs[a][b + 1]) a++;
    else b++;
  }
  gap(n, m);
  return out;
}

// a step put back as it was before a Claude run: in its place (step n), or, deleted since, where it was
export function restoreRunStep(local: Test, base: Step, gone: Gone | null, n: number): Test {
  const steps = local.steps.slice();
  if (gone) steps.splice(gone.at + 1, 0, structuredClone(base));
  else steps[n - 1] = structuredClone(base);
  return { ...local, steps };
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
