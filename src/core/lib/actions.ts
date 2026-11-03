import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { listJobs } from "../jobs.ts";
import type { ClaudeAction, ClaudeScope } from "../types.ts";
import { findDoc } from "./docs.ts";
import { sha256 } from "./hash.ts";
import { readJson, writeJson } from "./project.ts";
import { contentPrint, testDir } from "./store.ts";
import { parseTest } from "./testfile.ts";

export type Listed = ClaudeAction & { stale: boolean };

const dir = (project: string) => join(project, ".testimus", "actions");
const file = (project: string, id: string) => join(dir(project), `${id}.json`);

export const WHERE = /^(doc|test|job):[A-Za-z0-9][\w.-]*$|^project$/;

export function whereOf(scope: ClaudeScope): string {
  if (scope.kind === "doc") return `doc:${scope.docId}`;
  if (scope.kind === "step" || scope.kind === "test") return `test:${scope.testId}`;
  return "project";
}

// ponytail: an action is about the state it was proposed on — the document as converted, the test as written (its
// content: a review, a key or a folder that moves leaves the problem as it was), the job as it ended; when that state
// changes the problem may be gone or different, so the button goes (stale)
export function stampOf(project: string, where: string): string {
  const [kind, id] = where.split(":");
  if (kind === "doc") {
    const d = findDoc(project, id);
    if (!d) return "gone";
    return sha256(`${d.convertedAt}|${d.source?.sha256}|${(d.warnings ?? []).join("\n")}`).slice(0, 16);
  }
  if (kind === "test") {
    const f = join(testDir(project, id), "test.md");
    return existsSync(f) ? contentPrint(parseTest(readFileSync(f, "utf8")).test).slice(0, 16) : "gone";
  }
  if (kind === "job") return existsSync(join(project, ".testimus", "jobs", `${id}.jsonl`)) ? "job" : "gone";
  return "project";
}

export function readAction(project: string, id: string): ClaudeAction {
  if (!/^act-[\w-]+$/.test(id) || !existsSync(file(project, id)))
    throw new UserError(`No Claude action ${id} in this project.`, "testimus actions list shows them.");
  return readJson<ClaudeAction>(file(project, id), {} as ClaudeAction);
}

export function writeAction(project: string, a: ClaudeAction): ClaudeAction {
  writeJson(file(project, a.id), a);
  return a;
}

// ponytail: what an action left without a suggestion runs with — the wider the scope and the longer the plan, the more
// model and effort it needs; Opus and xhigh at most
export function suggestFor(a: Pick<ClaudeAction, "scope" | "plan">): NonNullable<ClaudeAction["suggest"]> {
  const long = a.plan.length > 4;
  if (a.scope.kind === "step") return { model: "sonnet", effort: long ? "high" : "medium" };
  if (a.scope.kind === "test" || a.scope.kind === "tests") return { model: "sonnet", effort: "high" };
  return { model: "opus", effort: long ? "xhigh" : "high" };
}

// ponytail: a run cut short by the app stopping leaves its action « running » — it is open again once no job runs it
export const runningNow = (project: string, id: string, except?: string) =>
  listJobs(project).some((j) => j.status === "running" && j.subject === id && j.id !== except);

export const listed = (project: string, a: ClaudeAction): Listed => ({
  ...a,
  state: a.state === "running" && !runningNow(project, a.id) ? "open" : a.state,
  suggest: a.suggest ?? suggestFor(a),
  stale: a.state !== "done" && stampOf(project, a.where) !== a.stamp,
});

export function allActions(project: string): Listed[] {
  if (!existsSync(dir(project))) return [];
  return readdirSync(dir(project))
    .filter((f) => /^act-[\w-]+\.json$/.test(f))
    .map((f) => readJson<ClaudeAction | null>(join(dir(project), f), null))
    .filter((a): a is ClaudeAction => !!a?.id)
    .map((a) => listed(project, a))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type Proposal = Pick<ClaudeAction, "title" | "scope" | "problem" | "why" | "plan" | "proposedBy" | "suggest"> & {
  where?: string;
};

// ponytail: one open action per problem — a second proposal for the same problem replaces the first, and a problem
// the user dismissed stays dismissed while it is the same
export function proposeAction(project: string, p: Proposal): ClaudeAction & { ignored?: boolean } {
  const where = p.where ?? whereOf(p.scope);
  if (!WHERE.test(where))
    throw new UserError(`Not a problem place: ${where}.`, "Use doc:<id>, test:<id>, job:<id> or project.");
  const stamp = stampOf(project, where);
  if (stamp === "gone") throw new UserError(`${where} does not exist in this project.`);
  const same = allActions(project).filter((a) => a.where === where && a.problem === p.problem && a.stamp === stamp);
  const dismissed = same.find((a) => a.state === "dismissed");
  if (dismissed) return { ...dismissed, ignored: true };
  const open = same.find((a) => a.state === "open");
  const now = env.now().toISOString();
  return writeAction(project, {
    id: open?.id ?? `act-${now.replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`,
    title: p.title.trim(),
    scope: p.scope,
    where,
    problem: p.problem.trim(),
    why: p.why.trim(),
    plan: p.plan.map((s) => s.trim()).filter(Boolean),
    stamp,
    proposedBy: p.proposedBy,
    suggest: p.suggest ?? suggestFor(p),
    state: "open",
    at: now,
  });
}

export type ActionFilter = { docId?: string; testId?: string; jobId?: string; all?: boolean };

export function listActions(project: string, f: ActionFilter = {}): Listed[] {
  return allActions(project).filter((a) => {
    if (!f.all && (a.stale || a.state === "done" || a.state === "dismissed")) return false;
    const s = a.scope;
    if (f.docId && a.where !== `doc:${f.docId}` && !(s.kind === "doc" && s.docId === f.docId)) return false;
    if (f.testId && a.where !== `test:${f.testId}` && !("testId" in s && s.testId === f.testId)) return false;
    if (f.jobId && a.where !== `job:${f.jobId}`) return false;
    return true;
  });
}
