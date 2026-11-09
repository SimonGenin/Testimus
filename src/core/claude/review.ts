import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { fileMemo } from "../lib/file-memo.ts";
import { natural } from "../lib/natural.ts";
import { osUser, setReview } from "../lib/review.ts";
import { listLocalTests, readTest, testDir, testExists } from "../lib/store.ts";
import type { LocalTestRef, Review, Test } from "../types.ts";
import { inFolder } from "./check.ts";
import { readLedger } from "./ledger.ts";

export type QueueItem = {
  id: string;
  key?: string;
  summary: string;
  folder: string;
  review: Review;
  note?: string;
  edited: boolean;
  unchecked: boolean;
  errors: number;
  warnings: number;
  infos: number;
  stale: boolean;
  mtime: number;
  generatedBy?: string;
  generatedAt?: string;
};

export type QueueSort = "state" | "anomalies" | "folder" | "recent";

export type QueueFilter = { state?: Review[]; folder?: string; withFindings?: boolean; sort: QueueSort };

const AWAITING: Review[] = ["draft", "to-fix"];
const STATE_RANK: Record<Review, number> = { draft: 0, "to-fix": 1, validated: 2 };

export function needTest(project: string, t: string): void {
  if (!testExists(project, t))
    throw new UserError(`No test ${t} in this project.`, "testimus tests list shows the tests.");
}

// ponytail: the reviewer's decision — validate, or to-fix with what is wrong; who and when are stamped. draft takes a
// decision back: the test awaits review again, without a note or a reviewer
export function decide(project: string, id: string, decision: "validate" | "to-fix" | "draft", rawNote?: string): Test {
  if (decision === "draft") return setReview(project, id, { review: "draft", note: null, by: null, at: null });
  const note = rawNote?.trim() || null;
  if (decision === "to-fix" && !note)
    throw new UserError("A To fix decision needs a note.", 'Say what is wrong, e.g. --note "Step 2 must check …".');
  return setReview(project, id, {
    review: decision === "validate" ? "validated" : "to-fix",
    note,
    by: osUser(),
    at: env.now().toISOString(),
  });
}

// ponytail: what the queue needs of a test beyond its row, read once per version of its test.md
const said = fileMemo<{ reviewNote?: string; generatedBy?: string }>();
const reviewOf = (project: string, id: string) =>
  said(join(testDir(project, id), "test.md"), [join(testDir(project, id), "test.md")], () => {
    const { reviewNote, generatedBy } = readTest(project, id).test;
    return { reviewNote, generatedBy };
  });

function itemOf(project: string, t: LocalTestRef, when: (generation: string) => string | undefined): QueueItem {
  const test = reviewOf(project, t.id);
  const note = t.review === "to-fix" ? test.reviewNote : undefined;
  const at = test.generatedBy ? when(test.generatedBy) : undefined;
  return {
    id: t.id,
    ...(t.key ? { key: t.key } : {}),
    summary: t.summary,
    folder: t.folder,
    review: t.review,
    ...(note ? { note } : {}),
    edited: t.edited,
    unchecked: !t.findings,
    errors: t.findings?.errors ?? 0,
    warnings: t.findings?.warnings ?? 0,
    infos: t.findings?.infos ?? 0,
    stale: t.findings?.stale ?? false,
    mtime: t.mtime,
    ...(test.generatedBy ? { generatedBy: test.generatedBy } : {}),
    ...(at ? { generatedAt: at } : {}),
  };
}

const byId = (a: QueueItem, b: QueueItem) => natural(a.id, b.id);
const byAnomalies = (a: QueueItem, b: QueueItem) => b.errors - a.errors || b.warnings - a.warnings;
const byState = (a: QueueItem, b: QueueItem) => STATE_RANK[a.review] - STATE_RANK[b.review];
const SORTS: Record<QueueSort, (a: QueueItem, b: QueueItem) => number> = {
  state: (a, b) => byState(a, b) || byAnomalies(a, b) || byId(a, b),
  anomalies: (a, b) => byAnomalies(a, b) || byState(a, b) || byId(a, b),
  folder: (a, b) => a.folder.localeCompare(b.folder) || byState(a, b) || byId(a, b),
  recent: (a, b) => b.mtime - a.mtime || byId(a, b),
};

// ponytail: only generated tests are reviewed — one written by hand, pulled or imported never enters the queue
export function reviewQueue(project: string, f: QueueFilter) {
  const states = f.state?.length ? f.state : AWAITING;
  const ats = new Map<string, string | undefined>();
  const when = (g: string) => {
    if (!ats.has(g)) ats.set(g, readLedger(project, g)?.at);
    return ats.get(g);
  };
  const generated = listLocalTests(project)
    .filter((t) => t.generated)
    .map((t) => itemOf(project, t, when));
  const awaiting = generated.filter((t) => t.review !== "validated");
  const tests = generated
    .filter((t) => states.includes(t.review))
    .filter((t) => f.folder === undefined || inFolder(t.folder, f.folder))
    .filter((t) => !f.withFindings || t.errors + t.warnings > 0)
    .sort(SORTS[f.sort]);
  const n = (r: Review) => awaiting.filter((t) => t.review === r).length;
  return {
    tests,
    counts: {
      toFix: n("to-fix"),
      draft: n("draft"),
      unchecked: awaiting.filter((t) => t.unchecked).length,
      validated: generated.length - awaiting.length,
    },
  };
}
