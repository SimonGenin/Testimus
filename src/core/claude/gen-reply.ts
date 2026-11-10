import { z } from "zod";
import { type Corpus, sourceProblem } from "../lib/check.ts";
import { testExists } from "../lib/store.ts";
import { parseSource } from "../lib/testfile.ts";
import { normalizeRef } from "../rag/anchors.ts";
import { type Ledger, wasOpened } from "./ledger.ts";
import { type Block, readBlock } from "./parts.ts";

// ponytail: what a generation run answers — the report block of the generate-tests skill, or the plan of plan-tests —
// and above all what it did not write. A behavior left without a test is coverage taken away, so it is said like a
// step is: a reason from a closed list, what was searched and read before giving up, the passage that asks for it,
// what would let it be written. Testimus then checks what can be checked without a model (doubts) and a second look
// judges the reason (review)

export const REPORT_TAG = "gen-report";
export const PLAN_TAG = "test-plan";
export const isSection = (s: string) => /^[^#\s]+#\S.*$/.test(s);

export const SKIP_REASONS = [
  "no-source",
  "not-observable",
  "already-tested",
  "out-of-scope",
  "documents-disagree",
  "missing-material",
  "stopped",
  "other",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const REASON_LABEL: Record<SkipReason, string> = {
  "no-source": "No source for the expected result",
  "not-observable": "Nothing a tester can observe",
  "already-tested": "Already tested",
  "out-of-scope": "Outside the request",
  "documents-disagree": "The documents disagree",
  "missing-material": "Something is missing from the project",
  stopped: "Stopped before it was written",
  other: "Other",
};

export const REASON_HELP: Record<Exclude<SkipReason, "stopped" | "other">, string> = {
  "no-source":
    "the documents ask for it, and no passage states what the tester must see — after you searched for it (searched and read say where)",
  "not-observable":
    "internal logic, a design deliverable, a capacity no screen shows: nothing happens that a tester can see or hear",
  "already-tested": "an existing test of the project verifies it — name it (test)",
  "out-of-scope": "the scope touches it, and the request did not ask for it",
  "documents-disagree": "two passages say otherwise and precedence does not settle it — cite both",
  "missing-material":
    "what would state it is not in the project: a figure lost in conversion, a document only referred to, a definition left to a later phase",
};

export const STOPPED = REASON_LABEL.stopped;
export const OTHER = REASON_LABEL.other;

export type SkipReview = { verdict: "confirmed" | "writable" | "unsure"; why: string; sources?: string[] };

export type Skipped = {
  item: string;
  reason: SkipReason;
  /** the words the items are grouped under: the reason's, or Claude's own in a report older than the reasons */
  category: string;
  why: string;
  sources?: string[];
  searched?: string[];
  read?: string[];
  unblock?: string;
  test?: string;
  /** what Testimus could not confirm, without a model */
  doubts?: string[];
  review?: SkipReview;
};

export type SkippedGroup = { category: string; items: Skipped[] };

const strings = z.array(z.string().trim().min(1));

const SKIP = z
  .object({
    item: z.string().trim().min(3).describe("The behavior, in a few words"),
    reason: z.enum(SKIP_REASONS.filter((r) => r !== "stopped" && r !== "other") as [SkipReason, ...SkipReason[]]),
    why: z.string().trim().min(20).describe("One or two concrete sentences for this item"),
    sources: strings.default([]).describe('The passages that ask for it: docId#anchor "quote"'),
    searched: strings.default([]).describe("What you searched before giving up: the terms"),
    read: strings.default([]).describe("The docId#anchor you opened for it"),
    unblock: z.string().trim().default("").describe("What would let the test be written, and who can bring it"),
    test: z.string().trim().default("").describe("already-tested: the id of the test that verifies it"),
  })
  .superRefine((s, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (s.reason === "no-source" || s.reason === "missing-material") {
      need(s.searched.length > 0, "searched", `${s.reason}: say what you searched before giving up`);
      need(s.unblock.length >= 10, "unblock", `${s.reason}: say what would let the test be written`);
    }
    if (s.reason === "already-tested") need(!!s.test, "test", "already-tested: name the test that verifies it");
    if (s.reason !== "already-tested")
      need(s.sources.length > 0, "sources", 'give the passage that asks for it: docId#anchor "quote"');
    if (s.reason === "documents-disagree")
      need(s.sources.length > 1, "sources", "documents-disagree: cite the two passages");
  });

export const REPORT = z.object({
  tests: strings.default([]).describe("The folders (local-…) of the tests written"),
  skipped: z.array(SKIP).default([]).describe("Every behavior of the request no step was written for"),
  covered: strings.default([]).describe("Items not written before, written now"),
});

export const PLAN = z.object({
  tests: z
    .array(
      z.object({
        summary: z.string().trim().min(3),
        technique: z.string().trim().default(""),
        sections: strings.default([]),
      }),
    )
    .min(1),
  skipped: z.array(SKIP).default([]),
});

const told = (s: z.output<typeof SKIP>): Skipped => ({
  item: s.item,
  reason: s.reason,
  category: REASON_LABEL[s.reason],
  why: s.why,
  ...(s.sources.length ? { sources: s.sources } : {}),
  ...(s.searched.length ? { searched: s.searched } : {}),
  ...(s.read.length ? { read: s.read } : {}),
  ...(s.unblock ? { unblock: s.unblock } : {}),
  ...(s.test ? { test: s.test } : {}),
});

export type GenReport = { found: boolean; tests: string[]; skipped: Skipped[]; covered: string[]; errors: string[] };
export type PlannedTest = { summary: string; technique: string; sections: string[] };
export type TestPlan = { found: boolean; tests: PlannedTest[]; skipped: Skipped[]; errors?: string[] };

const none = <T>(b: Block<T>) => ({ found: false as const, errors: b.errors });

export function parseGenReport(text: string): GenReport {
  const b = readBlock(text, REPORT_TAG, REPORT);
  if (!b.value) return { ...none(b), tests: [], skipped: [], covered: [] };
  return {
    found: true,
    tests: b.value.tests,
    skipped: b.value.skipped.map(told),
    covered: b.value.covered,
    errors: [],
  };
}

// ponytail: a planned test keeps only the sections written docId#anchor
export function parsePlan(text: string): TestPlan {
  const b = readBlock(text, PLAN_TAG, PLAN);
  if (!b.value) return { ...none(b), tests: [], skipped: [] };
  return {
    found: true,
    tests: b.value.tests.map((t) => ({ ...t, sections: t.sections.filter(isSection) })),
    skipped: b.value.skipped.map(told),
  };
}

const isReason = (v: unknown): v is SkipReason => (SKIP_REASONS as readonly unknown[]).includes(v);

// ponytail: an item as a ledger holds it — one written before the reasons existed (a category in Claude's words, or a
// bare string) still reads: its reason is « other » and its words are kept to group it
export function asSkipped(v: unknown): Skipped[] {
  if (!Array.isArray(v)) return [];
  const out: Skipped[] = [];
  for (const u of v) {
    if (typeof u === "string" && u.trim()) out.push({ item: u.trim(), reason: "other", category: OTHER, why: "" });
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    const list = (k: string) =>
      Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    const item = text("item");
    if (!item) continue;
    const old = text("category").replace(/\s+/g, " ");
    const reason: SkipReason = isReason(o.reason) ? o.reason : old === STOPPED ? "stopped" : "other";
    const sources = list("sources").filter((s) => parseSource(s));
    const r = o.review as Record<string, unknown> | undefined;
    const verdict = r && ["confirmed", "writable", "unsure"].includes(r.verdict as string) ? r.verdict : undefined;
    out.push({
      item,
      reason,
      category: reason === "other" ? old || OTHER : REASON_LABEL[reason],
      why: text("why"),
      ...(sources.length ? { sources } : {}),
      ...(list("searched").length ? { searched: list("searched") } : {}),
      ...(list("read").length ? { read: list("read") } : {}),
      ...(text("unblock") ? { unblock: text("unblock") } : {}),
      ...(text("test") ? { test: text("test") } : {}),
      ...(list("doubts").length ? { doubts: list("doubts") } : {}),
      ...(verdict
        ? {
            review: {
              verdict: verdict as SkipReview["verdict"],
              why: typeof r?.why === "string" ? r.why : "",
              ...(Array.isArray(r?.sources)
                ? { sources: (r.sources as unknown[]).filter((x) => typeof x === "string") as string[] }
                : {}),
            },
          }
        : {}),
    });
  }
  return out;
}

// ponytail: the one grouping of the items not written — by their reason (the words of an older report), the largest
// group first, then in the order they were reported. The results carry the items in this order (inCategoryOrder), so
// the page only cuts the list where the category changes
export function byCategory(skipped: Skipped[]): SkippedGroup[] {
  const groups: SkippedGroup[] = [];
  for (const s of skipped) {
    const g = groups.find((x) => x.category === s.category);
    if (g) g.items.push(s);
    else groups.push({ category: s.category, items: [s] });
  }
  return groups
    .map((g, k) => ({ g, k }))
    .sort((a, b) => b.g.items.length - a.g.items.length || a.k - b.k)
    .map(({ g }) => g);
}

export const inCategoryOrder = (skipped: Skipped[]): Skipped[] => byCategory(skipped).flatMap((g) => g.items);

const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const anchorsOf = (s: Skipped) =>
  (s.sources ?? []).flatMap((x) => {
    const p = parseSource(x);
    return p ? [normalizeRef(`${p.docId}#${p.anchor}`)] : [];
  });

// ponytail: the plan and each run of a generation report on their own, so the same behavior comes back several times
// under other words — one is kept when the reason is the same and the items share their words or the passage that
// asks for them (the fuller report wins). An item a run says another test of this generation takes is not left out at
// all: it is dropped
export function dedupeSkipped(skipped: Skipped[], written: string[] = []): Skipped[] {
  const out: Skipped[] = [];
  const size = (s: Skipped) => s.why.length + (s.searched?.length ?? 0) * 40 + (s.read?.length ?? 0) * 40;
  for (const s of skipped) {
    if (s.reason === "already-tested" && s.test && written.includes(s.test)) continue;
    const mine = new Set(anchorsOf(s));
    const lines = new Set((s.sources ?? []).map(key));
    const at = out.findIndex(
      (o) =>
        o.reason === s.reason &&
        (key(o.item) === key(s.item) ||
          (o.sources ?? []).some((x) => lines.has(key(x))) ||
          (s.reason !== "no-source" && mine.size > 0 && anchorsOf(o).some((a) => mine.has(a)))),
    );
    if (at < 0) out.push(s);
    else if (size(s) > size(out[at])) out[at] = s;
  }
  return out;
}

// ponytail: what can be checked about an item without a model — the passage that asks for it exists and holds its
// quote, the test said to verify it exists, what the run says it read it really opened, and a run that gives up for
// want of a source searched first. A doubt is told beside the item; it never removes it
export function skipDoubts(project: string, s: Skipped, corpus: Corpus, ledger: Ledger): string[] {
  const out: string[] = [];
  for (const line of s.sources ?? []) {
    const src = parseSource(line);
    const problem = src ? sourceProblem(corpus, src) : `"${line.slice(0, 60)}" is not docId#anchor "quote"`;
    if (problem) out.push(`Its source does not hold: ${problem}.`);
  }
  if (s.reason === "already-tested" && s.test && !testExists(project, s.test))
    out.push(`It names the test ${s.test}, which is not in this project.`);
  const unopened = (s.read ?? []).filter((r) => !wasOpened(project, ledger.consulted, r));
  if (unopened.length)
    out.push(`The run says it read ${unopened.join(", ")}, and never opened ${unopened.length === 1 ? "it" : "them"}.`);
  if ((s.reason === "no-source" || s.reason === "missing-material") && !ledger.searched.length)
    out.push("The run gave up without a single search of the documents.");
  return out;
}
