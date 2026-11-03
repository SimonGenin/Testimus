import { UserError } from "../command.ts";
import type { Source, Test } from "../types.ts";
import { fieldName, isReserved, parseSource } from "./testfile.ts";

export type StepOp =
  | { op: "set"; step: number; field: string; value: string }
  | { op: "add"; at?: number; fields: Record<string, string>; sources: string[] }
  | { op: "remove"; step: number }
  | { op: "move"; step: number; to: number }
  | { op: "sources"; step: number; sources: string[] };

export function toSources(lines: string[]): Source[] {
  return lines.map((l) => {
    const s = parseSource(l);
    if (!s?.quote)
      throw new UserError(
        `Source "${l}" is not docId#anchor "quote".`,
        'Write it as SOSIE_211_D401-1_3#§5.6.6 "exact quote".',
      );
    return s;
  });
}

const renamed = (fields: Record<string, string>, known: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [fieldName(k, known), v]));

// ponytail: the review keys are the reviewer's and the generation's, never the editor's — a save keeps
// what is on disk (only review.set, the check and the fix change them), and so does every key the
// parser kept as written, which the editor cannot see
export function keepReview(onDisk: Test, saved: Test): Test {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(saved.extra ?? {})) if (!isReserved(k)) extra[k] = v;
  for (const [k, v] of Object.entries(onDisk.extra)) if (isReserved(k)) extra[k] = v;
  return {
    ...saved,
    review: onDisk.review,
    reviewNote: onDisk.reviewNote,
    reviewedBy: onDisk.reviewedBy,
    reviewedAt: onDisk.reviewedAt,
    generatedBy: onDisk.generatedBy,
    extra,
  };
}

export function applyOps(t: Test, ops: StepOp[], known: readonly string[]): void {
  const at = (n: number) => {
    if (n < 1 || n > t.steps.length)
      throw new UserError(
        `Step ${n} does not exist — the test has ${t.steps.length} step(s).`,
        "Number the steps from 1, as tests.show lists them.",
      );
    return n - 1;
  };
  for (const o of ops) {
    if (o.op === "set") t.steps[at(o.step)].fields[fieldName(o.field, known)] = o.value;
    else if (o.op === "add") {
      const pos = o.at === undefined ? t.steps.length : Math.min(Math.max(o.at, 1), t.steps.length + 1) - 1;
      t.steps.splice(pos, 0, { fields: renamed(o.fields, known), sources: toSources(o.sources), images: [] });
    } else if (o.op === "remove") t.steps.splice(at(o.step), 1);
    else if (o.op === "move") {
      const [s] = t.steps.splice(at(o.step), 1);
      t.steps.splice(Math.min(Math.max(o.to, 1), t.steps.length + 1) - 1, 0, s);
    } else t.steps[at(o.step)].sources = toSources(o.sources);
  }
}
