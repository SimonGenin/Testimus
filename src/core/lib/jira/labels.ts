import type { Review } from "../../types.ts";
import { LEGACY_DRAFT, REVIEWS } from "../../types.ts";

// The review state travels as one label: `<prefix><review>`, replacing any other review label of
// the same prefix; other labels, the team's own `<prefix>…` ones included, are left as they are.
// ponytail: an empty prefix would make `draft`, `validated`… — the team's own labels — ours to replace,
// and Jira labels hold no space: either falls back to the default
export const DEFAULT_LABEL_PREFIX = "testimus-";
export const labelPrefixOf = (prefix: string) => (prefix && !/\s/.test(prefix) ? prefix : DEFAULT_LABEL_PREFIX);

// ponytail: test.md never holds the review label — `review:` is the one truth; the label exists in Jira only
export function withoutReviewLabels(labels: string[], prefix: string): string[] {
  const p = labelPrefixOf(prefix);
  const own = new Set([...REVIEWS, LEGACY_DRAFT].map((r) => p + r));
  return labels.filter((l) => !own.has(l));
}

export function reviewLabels(labels: string[], review: Review, prefix: string): string[] {
  return [...withoutReviewLabels(labels, prefix), labelPrefixOf(prefix) + review];
}

export function reviewOfLabels(labels: string[], prefix: string): Review | undefined {
  const p = labelPrefixOf(prefix);
  return REVIEWS.find((r) => labels.includes(p + r)) ?? (labels.includes(p + LEGACY_DRAFT) ? "draft" : undefined);
}
