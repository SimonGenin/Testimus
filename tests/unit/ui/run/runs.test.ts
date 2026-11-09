import { describe, expect, it } from "vitest";
import {
  folderGroups,
  marksLine,
  NO_RUNS_FILTER,
  type RunSummary,
  type RunsFilters,
  type RunsSort,
  type RunTestView,
  runsOptions,
  shownRuns,
  shownTests,
  TEST_VIEW,
} from "../../../../src/ui/screens/run/runs.ts";

const test = (
  id: string,
  o: {
    status?: RunTestView["result"]["status"];
    marks?: (boolean | null)[];
    folder?: string;
    at?: string;
    q?: number;
    shots?: number;
    text?: string;
  } = {},
): RunTestView => ({
  id,
  summary: `Test ${id}`,
  preconditions: [],
  ...(o.folder ? { folder: o.folder } : {}),
  steps: (o.marks ?? [null]).map(() => ({ fields: { Action: o.text ?? "Ouvrir" }, images: [] })),
  result: {
    status: o.status ?? "not-run",
    steps: (o.marks ?? [null]).map((ok) => ({ ok })),
    comments: [],
    attachments: Array.from({ length: o.shots ?? 0 }, (_, i) => ({ file: `capture-0000000${i}.png` })),
    ...(o.at ? { updatedAt: o.at } : {}),
    proposed: null,
    openQuestions: o.q ?? 0,
  },
});

const T = [
  test("a", { status: "passed", marks: [true, true], folder: "/Traction", at: "2026-11-08T10:00:00Z" }),
  test("b", { marks: [true, false, null], folder: "/Signalisation", at: "2026-11-08T12:00:00Z", shots: 1 }),
  test("c", { status: "problem", marks: [false], folder: "/Traction", q: 1, text: "Fermer le disjoncteur" }),
  test("d", { status: "blocked", folder: "/Signalisation" }),
  test("e", { marks: [null, null] }),
];
const ids = (ts: RunTestView[]) => ts.map((t) => t.id);

describe("the tests of a run, filtered and sorted", () => {
  it("filters by result, open questions, screenshots and words — the words read the steps too", () => {
    expect(ids(shownTests(T, { ...TEST_VIEW, filter: "to-run" }))).toEqual(["b", "e"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, filter: "problems" }))).toEqual(["c"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, filter: "questions" }))).toEqual(["c"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, shots: true }))).toEqual(["b"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, words: "disjoncteur fermer" }))).toEqual(["c"]);
    const mine = T.map((t) => (t.id === "a" ? { ...t, result: { ...t.result, updatedBy: "simon" } } : t));
    expect(ids(shownTests(mine, { ...TEST_VIEW, mine: true }, "simon"))).toEqual(["a"]);
    expect(ids(shownTests(mine, { ...TEST_VIEW, mine: true }, ""))).toEqual([]);
  });

  it("sorts by run order, result (problems first, a test being played before one not touched), last change, folder, steps left", () => {
    expect(ids(shownTests(T, TEST_VIEW))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, sort: "result" }))).toEqual(["c", "d", "b", "e", "a"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, sort: "change" }))).toEqual(["b", "a", "c", "d", "e"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, sort: "left" }))).toEqual(["b", "d", "e", "a", "c"]);
    expect(ids(shownTests(T, { ...TEST_VIEW, sort: "folder" }))).toEqual(["e", "b", "d", "a", "c"]);
  });

  it("groups by folder in the order the tests come, counts the done ones, and does not group a run without folders", () => {
    expect(folderGroups(T)).toEqual([
      { label: "Traction", keys: ["a", "c"], done: 2 },
      { label: "Signalisation", keys: ["b", "d"], done: 1 },
      { label: "No folder", keys: ["e"], done: 0 },
    ]);
    expect(folderGroups([test("x"), test("y")])).toEqual([]);
  });

  it("says every part of the marks", () => {
    expect(marksLine(T[1].result)).toBe("1 OK · 1 NOK · 1 to mark");
    expect(marksLine(T[0].result)).toBe("2 OK");
  });
});

describe("the runs, filtered and sorted", () => {
  const run = (slug: string, o: Partial<RunSummary>): RunSummary => ({
    slug,
    name: slug,
    createdAt: "2026-11-01T00:00:00Z",
    createdBy: "simon",
    total: 4,
    counts: { passed: 0, problem: 0, blocked: 0, notRun: 4 },
    openQuestions: 0,
    finished: false,
    ...o,
  });
  const R = [
    run("j4", {
      updatedAt: "2026-11-02T00:00:00Z",
      finished: true,
      counts: { passed: 3, problem: 1, blocked: 0, notRun: 0 },
    }),
    run("j5", {
      updatedAt: "2026-11-08T00:00:00Z",
      createdBy: "ana",
      counts: { passed: 1, problem: 2, blocked: 0, notRun: 1 },
    }),
    run("j6", { openQuestions: 2 }),
  ];
  const f = (o: Partial<RunsFilters>): RunsFilters => ({ ...NO_RUNS_FILTER, ...o });
  it("keeps by state, who made it, what it has and words, and sorts by activity, name, progress or problems", () => {
    const slugs = (o: Partial<RunsFilters>, sort: RunsSort = "activity") => shownRuns(R, f(o), sort).map((r) => r.slug);
    expect(slugs({ states: ["open"] })).toEqual(["j5", "j6"]);
    expect(slugs({ states: ["open", "finished"] })).toEqual(["j5", "j4", "j6"]);
    expect(slugs({ has: ["questions"] })).toEqual(["j6"]);
    expect(slugs({ has: ["questions", "problems"] })).toEqual(["j5", "j4", "j6"]);
    expect(slugs({ by: ["ana"] })).toEqual(["j5"]);
    expect(slugs({ words: "ana" })).toEqual(["j5"]);
    expect(slugs({ states: ["open"], has: ["problems"] })).toEqual(["j5"]);
    expect(slugs({}, "progress")).toEqual(["j6", "j5", "j4"]);
    expect(slugs({}, "problems")).toEqual(["j5", "j4", "j6"]);
  });

  it("each menu counts what it would show with the other filters on, its own left out", () => {
    const o = runsOptions(R, f({ states: ["open"] }));
    expect(o.states).toEqual([
      { value: "open", label: "In progress", count: 2 },
      { value: "finished", label: "Finished", count: 1 },
    ]);
    expect(o.by).toEqual([
      { value: "ana", label: "ana", count: 1 },
      { value: "simon", label: "simon", count: 1 },
    ]);
    expect(o.has.map((h) => h.count)).toEqual([1, 0, 1]);
  });
});
