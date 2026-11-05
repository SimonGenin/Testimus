import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listJobs } from "../jobs.ts";
import { awaitsReview, REVIEWS, type Review } from "../types.ts";
import { stepColumns } from "./columns.ts";
import { docIds } from "./docs.ts";
import { readProject, readXray } from "./project.ts";
import { isGenerating, testsDir } from "./store.ts";
import { parseTest } from "./testfile.ts";

// ponytail: what the shell shows of the open project — its files and how many of each; test.md is read by the one
// parser, never by a regex on its frontmatter
export function projectOverview(dir: string) {
  const xray = readXray(dir);
  const columns = stepColumns(dir, xray);
  const review = Object.fromEntries(REVIEWS.map((r) => [r, 0])) as Record<Review, number>;
  let tests = 0;
  let awaiting = 0;
  const root = testsDir(dir);
  const ids = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !isGenerating(dir, e.name))
        .map((e) => e.name)
    : [];
  for (const id of ids) {
    const f = join(root, id, "test.md");
    if (!existsSync(f)) continue;
    tests++;
    const { test } = parseTest(readFileSync(f, "utf8"));
    review[test.review]++;
    if (awaitsReview({ review: test.review, generated: !!test.generatedBy })) awaiting++;
  }
  return {
    dir,
    project: readProject(dir),
    xray,
    fieldOrder: columns.map((c) => c.name),
    columns,
    counts: {
      docs: docIds(dir).length,
      tests,
      review,
      awaiting,
      jobsRunning: listJobs(dir).filter((j) => j.status === "running").length,
    },
  };
}
