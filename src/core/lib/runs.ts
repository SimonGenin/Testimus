import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { readJson, writeJson } from "./project.ts";

// ponytail: a run is a folder of the project (test-runs/<slug>/) — the team's shared state, like tests/: run.json
// holds a frozen copy of each test as it was when the run was made, results/<testId>.json what the tester found

export type RunStatus = "not-run" | "passed" | "problem" | "blocked";
export const RUN_STATUSES: readonly RunStatus[] = ["not-run", "passed", "problem", "blocked"];

// ponytail: sources — the step's claims and where they come from, frozen with it so the run opens the same passages
export type RunSource = { docId: string; anchor: string; quote: string; column?: string; item?: string };
export type RunStep = { fields: Record<string, string>; images: string[]; sources?: RunSource[] };
export type RunTest = {
  id: string;
  key?: string;
  folder?: string;
  summary: string;
  description?: string;
  preconditions: string[];
  steps: RunStep[];
};
export type RunFile = {
  name: string;
  createdAt: string;
  createdBy: string;
  importedAt?: string;
  tests: RunTest[];
};
export type StepMark = { ok: boolean | null; note?: string };
export type RunComment = {
  id: string;
  kind: "comment" | "question";
  step?: number;
  text: string;
  by: string;
  at: string;
  answer?: string;
  answeredBy?: string;
  answeredAt?: string;
};
export type RunAttachment = { file: string; step?: number };
export type ResultVersion = {
  status: RunStatus;
  steps: StepMark[];
  blockedReason?: string;
  updatedAt?: string;
  updatedBy?: string;
  replacedAt: string;
};
export type RunResult = {
  status: RunStatus;
  steps: StepMark[];
  blockedReason?: string;
  comments: RunComment[];
  attachments: RunAttachment[];
  updatedAt?: string;
  updatedBy?: string;
  history?: ResultVersion[];
};
export type RunCounts = { passed: number; problem: number; blocked: number; notRun: number };

export const runsDir = (project: string) => join(project, "test-runs");

export function runDir(project: string, slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw new UserError(
      `"${slug}" is not a run.`,
      "testimus runs list shows the runs (their folder under test-runs/).",
    );
  return join(runsDir(project), slug);
}

const RESULT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const resultFile = (dir: string, testId: string) => {
  if (!RESULT_ID.test(testId) || testId.includes("..")) throw new UserError(`"${testId}" is not a test id.`);
  return join(dir, "results", `${testId}.json`);
};

export function readRunFile(project: string, slug: string): RunFile {
  const file = join(runDir(project, slug), "run.json");
  if (!existsSync(file)) throw new UserError(`No run ${slug} in this project.`, "testimus runs list shows the runs.");
  return normalRun(readJson<Partial<RunFile>>(file, {}), slug);
}

export function normalRun(raw: Partial<RunFile>, fallbackName: string): RunFile {
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : fallbackName,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    ...(raw.importedAt ? { importedAt: String(raw.importedAt) } : {}),
    tests: (Array.isArray(raw.tests) ? raw.tests : [])
      .filter((t) => t && typeof t.id === "string" && RESULT_ID.test(t.id))
      .map((t) => ({
        id: t.id,
        ...(t.key ? { key: String(t.key) } : {}),
        ...(typeof t.folder === "string" ? { folder: t.folder } : {}),
        summary: typeof t.summary === "string" ? t.summary : t.id,
        ...(t.description ? { description: String(t.description) } : {}),
        preconditions: Array.isArray(t.preconditions) ? t.preconditions.map(String) : [],
        steps: (Array.isArray(t.steps) ? t.steps : []).map((s) => ({
          fields: Object.fromEntries(Object.entries(s?.fields ?? {}).map(([k, v]) => [k, String(v)])),
          images: Array.isArray(s?.images) ? s.images.map(String) : [],
          ...(Array.isArray(s?.sources) ? { sources: s.sources.flatMap(sourceOf) } : {}),
        })),
      })),
  };
}

function sourceOf(v: unknown): RunSource[] {
  if (!v || typeof v !== "object") return [];
  const s = v as Record<string, unknown>;
  if (typeof s.docId !== "string" || typeof s.anchor !== "string") return [];
  return [
    {
      docId: s.docId,
      anchor: s.anchor,
      quote: typeof s.quote === "string" ? s.quote : "",
      ...(typeof s.column === "string" ? { column: s.column } : {}),
      ...(typeof s.item === "string" ? { item: s.item } : {}),
    },
  ];
}

// ponytail: a result file is read tolerantly (a hand edit, a page of another version, another PC): what is not
// understood is dropped, every field kept has its type, the steps always match the frozen test's
const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const statusOf = (v: unknown): RunStatus => (RUN_STATUSES.includes(v as RunStatus) ? (v as RunStatus) : "not-run");
const stepIn = (v: unknown, steps: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= steps ? { step: v } : {};
const stamped = (r: Record<string, unknown>) => ({
  ...(text(r.updatedAt) ? { updatedAt: r.updatedAt as string } : {}),
  ...(text(r.updatedBy) ? { updatedBy: r.updatedBy as string } : {}),
});

function marksOf(raw: unknown, steps: number): StepMark[] {
  const marks = Array.isArray(raw) ? raw : [];
  return Array.from({ length: steps }, (_, i) => {
    const m = isObject(marks[i]) ? marks[i] : {};
    const note = text(m.note);
    return { ok: typeof m.ok === "boolean" ? m.ok : null, ...(note ? { note } : {}) };
  });
}

function commentOf(c: Record<string, unknown>, steps: number): RunComment {
  const answer = text(c.answer);
  return {
    id: c.id as string,
    kind: c.kind === "question" ? "question" : "comment",
    ...stepIn(c.step, steps),
    text: c.text as string,
    by: text(c.by) ?? "",
    at: text(c.at) ?? "",
    ...(answer ? { answer } : {}),
    ...(answer && text(c.answeredBy) ? { answeredBy: c.answeredBy as string } : {}),
    ...(answer && text(c.answeredAt) ? { answeredAt: c.answeredAt as string } : {}),
  };
}

function versionOf(h: Record<string, unknown>, steps: number): ResultVersion {
  const reason = text(h.blockedReason);
  return {
    status: statusOf(h.status),
    steps: marksOf(h.steps, steps),
    ...(reason ? { blockedReason: reason } : {}),
    ...stamped(h),
    replacedAt: text(h.replacedAt) ?? "",
  };
}

export function normalResult(raw: unknown, steps: number): RunResult {
  const r = isObject(raw) ? raw : {};
  const reason = text(r.blockedReason);
  const history = (Array.isArray(r.history) ? r.history : []).filter(isObject).map((h) => versionOf(h, steps));
  return {
    status: statusOf(r.status),
    steps: marksOf(r.steps, steps),
    ...(reason ? { blockedReason: reason } : {}),
    comments: (Array.isArray(r.comments) ? r.comments : [])
      .filter((c) => isObject(c) && typeof c.id === "string" && typeof c.text === "string")
      .map((c) => commentOf(c, steps)),
    attachments: (Array.isArray(r.attachments) ? r.attachments : [])
      .filter((a) => isObject(a) && typeof a.file === "string" && /^[\w.-]+$/.test(a.file) && !a.file.startsWith("."))
      .map((a) => ({ file: a.file as string, ...stepIn(a.step, steps) })),
    ...stamped(r),
    ...(history.length ? { history } : {}),
  };
}

// ponytail: the one rule of the result the marks give — any NOK is Problem, every step OK Passed, else not run yet. A
// change of the marks sets the result by it (Blocked, the tester's call with its reason, stays); a result the tester
// picks stands until the marks change again, and the marks' word beside it is the proposal. The exported page keeps a
// copy of both (templates/run-pages/run.js), tested equal to these
export function marksStatus(steps: StepMark[]): RunStatus {
  if (steps.some((s) => s.ok === false)) return "problem";
  if (steps.length && steps.every((s) => s.ok === true)) return "passed";
  return "not-run";
}

export function proposedStatus(r: Pick<RunResult, "status" | "steps">): RunStatus | null {
  if (r.status === "blocked") return null;
  const m = marksStatus(r.steps);
  return m !== "not-run" && m !== r.status ? m : null;
}

export const openQuestionsOf = (r: RunResult) => r.comments.filter((c) => c.kind === "question" && !c.answer).length;

// ponytail: a result as the commands show it — the file, plus what the core reads in it (the result the marks
// propose, the open questions), so no face works it out again
export const resultView = (r: RunResult) => ({ ...r, proposed: proposedStatus(r), openQuestions: openQuestionsOf(r) });

export function readResult(project: string, slug: string, test: RunTest): RunResult {
  const file = resultFile(runDir(project, slug), test.id);
  return normalResult(existsSync(file) ? readJson<unknown>(file, {}) : null, test.steps.length);
}

export function writeResult(project: string, slug: string, testId: string, r: RunResult): void {
  writeJson(resultFile(runDir(project, slug), testId), r);
}

export function countsOf(results: RunResult[]): RunCounts {
  const n = (s: RunStatus) => results.filter((r) => r.status === s).length;
  return { passed: n("passed"), problem: n("problem"), blocked: n("blocked"), notRun: n("not-run") };
}

export const openQuestions = (results: RunResult[]) => results.reduce((sum, r) => sum + openQuestionsOf(r), 0);

export function runView(project: string, slug: string) {
  const run = readRunFile(project, slug);
  const tests = run.tests.map((t) => ({ ...t, result: readResult(project, slug, t) }));
  return { slug, ...run, tests };
}

export function runSummary(project: string, slug: string) {
  const { tests, ...run } = runView(project, slug);
  const results = tests.map((t) => t.result);
  const counts = countsOf(results);
  const updated = results.map((r) => r.updatedAt ?? "").sort();
  const last = updated[updated.length - 1];
  return {
    slug,
    name: run.name,
    createdAt: run.createdAt,
    createdBy: run.createdBy,
    ...(run.importedAt ? { importedAt: run.importedAt } : {}),
    ...(last ? { updatedAt: last } : {}),
    total: tests.length,
    counts,
    openQuestions: openQuestions(results),
    finished: tests.length > 0 && counts.notRun === 0,
  };
}

export function listRuns(project: string) {
  const dir = runsDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name) && existsSync(join(dir, e.name, "run.json")))
    .map((e) => runSummary(project, e.name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

// ponytail: the same test in every run that holds it (by its id, else its Jira key), newest run first — what it gave
// each time
export function testHistory(project: string, test: string) {
  const out = [];
  for (const s of listRuns(project)) {
    const run = readRunFile(project, s.slug);
    const t = run.tests.find((x) => x.id === test || (x.key && x.key === test));
    if (!t) continue;
    const r = readResult(project, s.slug, t);
    out.push({
      run: s.slug,
      name: run.name,
      createdAt: run.createdAt,
      status: r.status,
      ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
      ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
    });
  }
  return out;
}

export function removeRun(project: string, slug: string): void {
  readRunFile(project, slug);
  rmSync(runDir(project, slug), { recursive: true, force: true });
}
