import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { UserError } from "../command.ts";
import type { Review, Test } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { readTest, testDir } from "./store.ts";
import { frontmatterOf } from "./testfile.ts";

// ponytail: the review state of a test — the reviewer's decision written in test.md's frontmatter (review, note, who,
// when); the check reads it but never writes it

export const readTestReview = (project: string, id: string): Review => readTest(project, id).test.review;

export function osUser(): string {
  try {
    return userInfo().username || process.env.USERNAME || "unknown";
  } catch {
    return process.env.USERNAME || process.env.USER || "unknown";
  }
}

export type ReviewPatch = { review: Review; note?: string | null; by?: string | null; at?: string | null };

const plain = (v: string) =>
  v !== v.trim() || v.startsWith("[") || v.startsWith('"') || v.includes(" #") ? JSON.stringify(v) : v;

// ponytail: only the frontmatter lines change — the body keeps its bytes, so testHash and the
// findings it stamps stay fresh after a review decision
export function patchReview(md: string, p: ReviewPatch): string {
  const want: [string, string | null | undefined][] = [
    ["review", p.review],
    ["review_note", p.note === undefined || p.note === null ? p.note : JSON.stringify(p.note)],
    ["reviewed_by", p.by === undefined || p.by === null ? p.by : plain(p.by)],
    ["reviewed_at", p.at === undefined || p.at === null ? p.at : plain(p.at)],
  ];
  const touched = want.filter(([, v]) => v !== undefined);
  const keys = new Set(touched.map(([k]) => k));
  const fm = frontmatterOf(md);
  if (!fm)
    throw new UserError(
      "This test.md has no readable frontmatter (the --- lines around key, project, summary): the review decision was not written.",
      "Fix the --- lines at the top of test.md (or open the test in the editor), then decide again.",
    );
  const fresh = touched.filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
  const kept: string[] = [];
  let placed = false;
  let dropping = false;
  for (const line of fm.head) {
    if (dropping && /^\s/.test(line)) continue;
    dropping = false;
    const key = /^\s*([^:#]+?)\s*:/.exec(line)?.[1];
    if (key && keys.has(key)) {
      if (!placed) kept.push(...fresh);
      placed = true;
      dropping = true;
      continue;
    }
    kept.push(line);
  }
  if (!placed) kept.push(...fresh);
  return `${fm.bom}---${fm.nl}${kept.join(fm.nl)}${fm.nl}---${fm.rest}`;
}

export function setReview(project: string, id: string, p: ReviewPatch): Test {
  const file = join(testDir(project, id), "test.md");
  if (!existsSync(file)) throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.");
  writeAtomic(file, patchReview(readFileSync(file, "utf8"), p));
  return readTest(project, id).test;
}
