import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { readJson, writeJson } from "./project.ts";

// ponytail: a run is a folder of the project (test-runs/<slug>/) — the team's shared state, like tests/: run.json
// holds a frozen copy of each test as it was when the run was made, results/<testId>.json what the tester found

export type RunStatus = "not-run" | "passed" | "problem" | "blocked";
export const RUN_STATUSES: readonly RunStatus[] = ["not-run", "passed", "problem", "blocked"];

export type RunStep = { fields: Record<string, string>; images: string[] };
export type RunTest = {
  id: string;
  key?: string;
  summary: string;
  description?: string;
  preconditions: string[];
  steps: RunStep[];
};
export type RunFile = {
  name: string;
  version?: string;
  environment?: string;
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
    ...(raw.version ? { version: String(raw.version) } : {}),
    ...(raw.environment ? { environment: String(raw.environment) } : {}),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    ...(raw.importedAt ? { importedAt: String(raw.importedAt) } : {}),
    tests: (Array.isArray(raw.tests) ? raw.tests : [])
      .filter((t) => t && typeof t.id === "string" && RESULT_ID.test(t.id))
      .map((t) => ({
        id: t.id,
        ...(t.key ? { key: String(t.key) } : {}),
        summary: typeof t.summary === "string" ? t.summary : t.id,
        ...(t.description ? { description: String(t.description) } : {}),
        preconditions: Array.isArray(t.preconditions) ? t.preconditions.map(String) : [],
        steps: (Array.isArray(t.steps) ? t.steps : []).map((s) => ({
          fields: Object.fromEntries(Object.entries(s?.fields ?? {}).map(([k, v]) => [k, String(v)])),
          images: Array.isArray(s?.images) ? s.images.map(String) : [],
        })),
      })),
  };
}

// ponytail: a result file is read tolerantly (a hand edit, a page of another version): what is not understood is
// dropped, the steps always match the frozen test's
export function normalResult(raw: Partial<RunResult> | null | undefined, steps: number): RunResult {
  const r = raw ?? {};
  const status = RUN_STATUSES.includes(r.status as RunStatus) ? (r.status as RunStatus) : "not-run";
  const marks = Array.isArray(r.steps) ? r.steps : [];
  return {
    status,
    steps: Array.from({ length: steps }, (_, i) => {
      const m = marks[i];
      const ok = m && typeof m.ok === "boolean" ? m.ok : null;
      return { ok, ...(m && typeof m.note === "string" && m.note ? { note: m.note } : {}) };
    }),
    ...(typeof r.blockedReason === "string" && r.blockedReason ? { blockedReason: r.blockedReason } : {}),
    comments: (Array.isArray(r.comments) ? r.comments : []).filter(
      (c) => c && typeof c.id === "string" && typeof c.text === "string",
    ),
    attachments: (Array.isArray(r.attachments) ? r.attachments : []).filter(
      (a) => a && typeof a.file === "string" && /^[\w.-]+$/.test(a.file) && !a.file.startsWith("."),
    ),
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
    ...(typeof r.updatedBy === "string" ? { updatedBy: r.updatedBy } : {}),
    ...(Array.isArray(r.history) && r.history.length ? { history: r.history } : {}),
  };
}

export function readResult(project: string, slug: string, test: RunTest): RunResult {
  const file = resultFile(runDir(project, slug), test.id);
  return normalResult(existsSync(file) ? readJson<Partial<RunResult>>(file, {}) : null, test.steps.length);
}

export function writeResult(project: string, slug: string, testId: string, r: RunResult): void {
  writeJson(resultFile(runDir(project, slug), testId), r);
}

export function countsOf(results: RunResult[]): RunCounts {
  const n = (s: RunStatus) => results.filter((r) => r.status === s).length;
  return { passed: n("passed"), problem: n("problem"), blocked: n("blocked"), notRun: n("not-run") };
}

export const openQuestions = (results: RunResult[]) =>
  results.reduce((sum, r) => sum + r.comments.filter((c) => c.kind === "question" && !c.answer).length, 0);

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
    ...(run.version ? { version: run.version } : {}),
    ...(run.environment ? { environment: run.environment } : {}),
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

export function removeRun(project: string, slug: string): void {
  readRunFile(project, slug);
  rmSync(runDir(project, slug), { recursive: true, force: true });
}
