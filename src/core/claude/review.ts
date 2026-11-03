import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { osUser, setReview } from "../lib/review.ts";
import { listLocalTests, readTest, testExists } from "../lib/store.ts";
import type { LocalTestRef, Review, Test } from "../types.ts";
import { inFolder } from "./check.ts";

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
};

export type QueueSort = "state" | "anomalies" | "folder" | "recent";

export type QueueFilter = { state?: Review[]; folder?: string; withFindings?: boolean; sort: QueueSort };

const AWAITING: Review[] = ["checked", "to-fix", "draft"];
const STATE_RANK: Record<Review, number> = { checked: 0, "to-fix": 1, draft: 2, validated: 3 };

export function needTest(project: string, t: string): void {
  if (!testExists(project, t))
    throw new UserError(`No test ${t} in this project.`, "testimus tests list shows the tests.");
}

// ponytail: the reviewer's decision — validate, or to-fix with what is wrong; who and when are stamped
export function decide(project: string, id: string, decision: "validate" | "to-fix", rawNote?: string): Test {
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

function itemOf(project: string, t: LocalTestRef): QueueItem {
  const note = t.review === "to-fix" ? readTest(project, t.id).test.reviewNote : undefined;
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
  };
}

const byId = (a: QueueItem, b: QueueItem) => a.id.localeCompare(b.id, "en", { numeric: true });
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
  const generated = listLocalTests(project)
    .filter((t) => t.generated)
    .map((t) => itemOf(project, t));
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
      checked: n("checked"),
      toFix: n("to-fix"),
      draft: n("draft"),
      unchecked: awaiting.filter((t) => t.unchecked).length,
      validated: generated.length - awaiting.length,
    },
  };
}
