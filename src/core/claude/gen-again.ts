import { UserError } from "../command.ts";
import { testName } from "../lib/names.ts";
import { testExists } from "../lib/store.ts";
import type { Settled, TestPlan } from "./gen-plan.ts";
import type { AddPart, GenInput } from "./gen-prompt.ts";
import type { Skipped } from "./gen-reply.ts";
import { type GenLedger, readLedger, type Searched } from "./ledger.ts";

// ponytail: a generation asked again — resumed where its plan stopped, or added to (gen.revise add): what its ledger
// gives the new run, and the items not written once the run is done

export type Prior = {
  input: GenInput;
  runId: string;
  tests: string[];
  consulted: string[];
  searched: Searched[];
  plan: TestPlan;
  done: number[];
  skipped: Skipped[];
  /** the plan's questions the user answered: every run holds to them */
  settled: Settled[];
  /** the plan was waiting for the user's go: this is its first writing */
  planned: boolean;
};

export function readPrior(project: string, generation: string): Prior {
  const l = readLedger(project, generation);
  if (!l?.input || !l.runId || !l.plan?.tests?.length)
    throw new UserError(
      `No plan to resume under ${generation}.`,
      "Only a generation written from a plan can be resumed: its result names it (generation).",
    );
  return {
    input: l.input,
    runId: l.runId,
    tests: l.tests ?? [],
    consulted: l.consulted ?? [],
    searched: l.searched ?? [],
    plan: l.plan,
    done: l.done ?? [],
    skipped: (l.skipped ?? []).filter((s) => s.reason !== "stopped"),
    settled: l.settled ?? [],
    planned: l.state === "planned",
  };
}

const itemKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ponytail: an item not written before stays unless this run wrote it (covered) or reported it again (its new reason
// replaces the old one)
export function mergeSkipped(before: Skipped[], now: Skipped[], covered: string[]): Skipped[] {
  const gone = new Set([...covered, ...now.map((s) => s.item)].map(itemKey));
  return [...before.filter((s) => !gone.has(itemKey(s.item))), ...now];
}

export function addPart(project: string, base: GenLedger): AddPart {
  return {
    request: base.input?.request ?? "",
    tests: (base.tests ?? []).filter((id) => testExists(project, id)).map((id) => testName(project, id)),
    skipped: (base.skipped ?? []).filter((s) => s.reason !== "stopped"),
  };
}
