import { listJobs } from "../jobs.ts";
import { awaitsReview, REVIEWS, type Review } from "../types.ts";
import { stepColumns } from "./columns.ts";
import { docIds } from "./docs.ts";
import { readProject, readXray } from "./project.ts";
import { listLocalTests } from "./store.ts";

// ponytail: what the shell shows of the open project — its files and how many of each; the tests are counted from
// their rows (test.md read by the one parser, never by a regex on its frontmatter)
export function projectOverview(dir: string) {
  const xray = readXray(dir);
  const columns = stepColumns(dir, xray);
  const review = Object.fromEntries(REVIEWS.map((r) => [r, 0])) as Record<Review, number>;
  const listed = listLocalTests(dir);
  let awaiting = 0;
  for (const t of listed) {
    review[t.review]++;
    if (awaitsReview(t)) awaiting++;
  }
  return {
    dir,
    project: readProject(dir),
    xray,
    fieldOrder: columns.map((c) => c.name),
    columns,
    counts: {
      docs: docIds(dir).length,
      tests: listed.length,
      review,
      awaiting,
      jobsRunning: listJobs(dir).filter((j) => j.status === "running").length,
    },
  };
}
