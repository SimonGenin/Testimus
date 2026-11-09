import type { CommandOutput } from "../../../core/commands/index.ts";
import { fold, initials, plural } from "../../lib/format.ts";

export type RunView = CommandOutput<"runs.show">;
export type RunTestView = RunView["tests"][number];
export type RunResult = RunTestView["result"];
export type RunStatus = RunResult["status"];
export type RunSummary = CommandOutput<"runs.list">["runs"][number];

export const STATUS_ORDER: RunStatus[] = ["passed", "problem", "blocked", "not-run"];

// ponytail: the route of the Run screen — `#/run` (the list), `#/run/<run>` (a run and its tests), `#/run/<run>/<test>`
// (running one test)
export function routeOf(arg: string | undefined): { run: string; test: string } {
  const [run = "", ...rest] = (arg ?? "").split("/");
  return { run, test: rest.join("/") };
}

export function notesLine(r: RunResult): string {
  if (r.status === "blocked" && r.blockedReason) return `« ${r.blockedReason} »`;
  const comments = r.comments.filter((c) => c.kind === "comment").length;
  const questions = r.comments.filter((c) => c.kind === "question").length;
  const parts = [comments && plural(comments, "comment"), questions && plural(questions, "question")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export function clock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function day(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const byLine = (r: RunResult) => (r.updatedBy ? `${initials(r.updatedBy)} · ${clock(r.updatedAt)}` : "—");

export function listMeta(r: RunSummary): string {
  const run = r.total - r.counts.notRun;
  const problems = r.counts.problem ? ` · ${plural(r.counts.problem, "problem")}` : "";
  if (r.finished) return `${r.counts.passed} passed${problems} · ${day(r.updatedAt ?? r.createdAt)}`;
  return `${run} of ${r.total} run${problems} · ${r.createdBy}`;
}

// ponytail: the next test to play — the first not run after the one given, else from the start
export function nextNotRun(tests: RunTestView[], after?: string): RunTestView | undefined {
  const at = after ? tests.findIndex((t) => t.id === after) : -1;
  return [...tests.slice(at + 1), ...tests.slice(0, at + 1)].find((t) => t.result.status === "not-run");
}

export type StepCounts = { ok: number; nok: number; left: number };
export function stepCounts(r: Pick<RunResult, "steps">): StepCounts {
  const ok = r.steps.filter((s) => s.ok === true).length;
  const nok = r.steps.filter((s) => s.ok === false).length;
  return { ok, nok, left: r.steps.length - ok - nok };
}

// ponytail: « 3 OK · 1 NOK · 1 to mark » — every part said, none when zero
export function marksLine(r: Pick<RunResult, "steps">): string {
  const c = stepCounts(r);
  if (!r.steps.length) return "No step";
  return [c.ok && `${c.ok} OK`, c.nok && `${c.nok} NOK`, c.left && `${c.left} to mark`].filter(Boolean).join(" · ");
}

// a test not run whose steps are being marked is in progress: the list says so
export const inProgress = (t: RunTestView) =>
  t.result.status === "not-run" && t.result.steps.some((s) => s.ok !== null);

export const NO_FOLDER = "No folder";
export const folderOf = (t: Pick<RunTestView, "folder">) =>
  t.folder?.replace(/^\/+/, "").replace(/\//g, " / ") || NO_FOLDER;

export type TestFilter = "all" | "to-run" | "problems" | "blocked" | "passed" | "questions";
export const TEST_FILTERS: { value: TestFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "to-run", label: "To run" },
  { value: "problems", label: "Problems" },
  { value: "blocked", label: "Blocked" },
  { value: "passed", label: "Passed" },
  { value: "questions", label: "Questions" },
];
export const keepTest: Record<TestFilter, (t: RunTestView) => boolean> = {
  all: () => true,
  "to-run": (t) => t.result.status === "not-run",
  problems: (t) => t.result.status === "problem",
  blocked: (t) => t.result.status === "blocked",
  passed: (t) => t.result.status === "passed",
  questions: (t) => t.result.openQuestions > 0,
};

export type TestSort = "run" | "result" | "change" | "folder" | "left";
export const TEST_SORTS: { value: TestSort; label: string }[] = [
  { value: "run", label: "Run order" },
  { value: "result", label: "Result — problems first" },
  { value: "change", label: "Last change" },
  { value: "folder", label: "Folder, then name" },
  { value: "left", label: "Steps left to mark" },
];

// how a run's tests are shown: one view shared by the run's table and the list beside a test being run
export type TestView = {
  filter: TestFilter;
  words: string;
  sort: TestSort;
  group: boolean;
  shots: boolean;
  /** only the tests whose result the person here recorded last */
  mine: boolean;
};
export const TEST_VIEW: TestView = { filter: "all", words: "", sort: "run", group: true, shots: false, mine: false };

const RESULT_RANK: Record<RunStatus, number> = { problem: 0, blocked: 1, "not-run": 2, passed: 3 };
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// ponytail: the words find a test by its summary, key, id, folder and the text of its steps — what a tester remembers
export function wordsMatch(t: RunTestView, words: string): boolean {
  const q = words.trim().toLowerCase();
  if (!q) return true;
  const text = [t.summary, t.key ?? "", t.id, t.folder ?? "", ...t.steps.flatMap((s) => Object.values(s.fields))]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}

export function shownTests(tests: RunTestView[], v: TestView, me = ""): RunTestView[] {
  const kept = tests.filter(
    (t) =>
      keepTest[v.filter](t) &&
      wordsMatch(t, v.words) &&
      (!v.shots || t.result.attachments.length > 0) &&
      (!v.mine || (!!me && t.result.updatedBy === me)),
  );
  const at = new Map(tests.map((t, i) => [t.id, i]));
  const order = (a: RunTestView, b: RunTestView) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0);
  const by: Record<TestSort, (a: RunTestView, b: RunTestView) => number> = {
    run: order,
    result: (a, b) =>
      RESULT_RANK[a.result.status] - RESULT_RANK[b.result.status] ||
      Number(inProgress(b)) - Number(inProgress(a)) ||
      order(a, b),
    change: (a, b) => (b.result.updatedAt ?? "").localeCompare(a.result.updatedAt ?? "") || order(a, b),
    folder: (a, b) => natural(folderOf(a), folderOf(b)) || natural(a.summary, b.summary),
    left: (a, b) => {
      const l = (t: RunTestView) => stepCounts(t.result).left || Number.POSITIVE_INFINITY;
      return l(a) - l(b) || order(a, b);
    },
  };
  return [...kept].sort(by[v.sort]);
}

// ponytail: the folders in the order their first test comes — a sorted list keeps its order inside each folder; a run
// made before folders were kept has none, and is not grouped at all
export function folderGroups(tests: RunTestView[]): { label: string; keys: string[]; done: number }[] {
  if (tests.every((t) => !t.folder)) return [];
  const out = new Map<string, { label: string; keys: string[]; done: number }>();
  for (const t of tests) {
    const label = folderOf(t);
    const g = out.get(label) ?? { label, keys: [], done: 0 };
    g.keys.push(t.id);
    if (t.result.status !== "not-run") g.done++;
    out.set(label, g);
  }
  return [...out.values()];
}

export const countOf = (tests: RunTestView[], f: TestFilter) => tests.filter(keepTest[f]).length;

export type RunsSort = "activity" | "name" | "progress" | "problems";
export const RUNS_SORTS: { value: RunsSort; label: string }[] = [
  { value: "activity", label: "Last activity" },
  { value: "name", label: "Name" },
  { value: "progress", label: "Least done first" },
  { value: "problems", label: "Most problems first" },
];

export type RunsFilters = { words: string; states: string[]; by: string[]; has: string[] };
export const NO_RUNS_FILTER: RunsFilters = { words: "", states: [], by: [], has: [] };

const RUN_STATES: { value: string; label: string; is: (r: RunSummary) => boolean }[] = [
  { value: "open", label: "In progress", is: (r) => !r.finished },
  { value: "finished", label: "Finished", is: (r) => r.finished },
];
const RUN_HAS: { value: string; label: string; is: (r: RunSummary) => boolean }[] = [
  { value: "problems", label: "Problems", is: (r) => r.counts.problem > 0 },
  { value: "blocked", label: "Blocked tests", is: (r) => r.counts.blocked > 0 },
  { value: "questions", label: "Open questions", is: (r) => r.openQuestions > 0 },
];

const keeps = (r: RunSummary, f: RunsFilters, skip?: keyof RunsFilters) => {
  const words = fold(f.words).split(/\s+/).filter(Boolean);
  const hay = fold([r.name, r.createdBy].join(" "));
  return (
    (skip === "words" || words.every((w) => hay.includes(w))) &&
    (skip === "states" || !f.states.length || RUN_STATES.some((s) => f.states.includes(s.value) && s.is(r))) &&
    (skip === "by" || !f.by.length || f.by.includes(r.createdBy)) &&
    (skip === "has" || !f.has.length || RUN_HAS.some((h) => f.has.includes(h.value) && h.is(r)))
  );
};

// ponytail: each menu counts what it would show with the other filters as they are, its own left out
export function runsOptions(runs: RunSummary[], f: RunsFilters) {
  const rest = (skip: keyof RunsFilters) => runs.filter((r) => keeps(r, f, skip));
  const people = [...new Set(runs.map((r) => r.createdBy).filter(Boolean))].sort(natural);
  return {
    states: RUN_STATES.map((s) => ({ value: s.value, label: s.label, count: rest("states").filter(s.is).length })),
    by: people.map((p) => ({ value: p, label: p, count: rest("by").filter((r) => r.createdBy === p).length })),
    has: RUN_HAS.map((h) => ({ value: h.value, label: h.label, count: rest("has").filter(h.is).length })),
  };
}

const doneShare = (r: RunSummary) => (r.total ? (r.total - r.counts.notRun) / r.total : 1);

export function shownRuns(runs: RunSummary[], f: RunsFilters, sort: RunsSort): RunSummary[] {
  const kept = runs.filter((r) => keeps(r, f));
  const last = (r: RunSummary) => r.updatedAt ?? r.createdAt;
  const by: Record<RunsSort, (a: RunSummary, b: RunSummary) => number> = {
    activity: (a, b) => last(b).localeCompare(last(a)),
    name: (a, b) => natural(a.name, b.name),
    progress: (a, b) => doneShare(a) - doneShare(b) || natural(a.name, b.name),
    problems: (a, b) => b.counts.problem - a.counts.problem || last(b).localeCompare(last(a)),
  };
  return [...kept].sort(by[sort]);
}

export const runShare = (r: Pick<RunSummary, "total" | "counts">) =>
  Math.round(((r.total - r.counts.notRun) / (r.total || 1)) * 100);

// ponytail: the run's side panes, on the runs page and on a test being run alike: the list on the left, the panel on
// the right — one width each, kept in lib/prefs once dragged
export const RUN_LIST = { min: 240, max: 480, initial: 320 };
export const RUN_SIDE = { min: 300, max: 640, initial: 380 };
