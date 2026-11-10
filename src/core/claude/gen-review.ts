import { z } from "zod";
import { env } from "../env.ts";
import { proposeAction } from "../lib/actions.ts";
import { type Corpus, sourceProblem } from "../lib/check.ts";
import { parseSource } from "../lib/testfile.ts";
import type { Effort } from "../types.ts";
import type { AlsoAsked } from "./check.ts";
import { REASON_LABEL, type Skipped, type SkipReview } from "./gen-reply.ts";
import type { Suggestion } from "./ledger.ts";
import { readBlock } from "./parts.ts";

// ponytail: what is said about a generation once its tests are written rides in the request that checks them, as one
// more part — a second look at each behavior it left without a test (does the reason hold, or does a passage state
// what the tester must see after all), and a few requests worth asking next. No run of its own: the check has just read
// the same passages. Only a second look that found the passage leaves a Claude action; a reason that holds leaves
// nothing to do

export const REVIEW_TAG = "gen-review";
const MAX_LOOKED = 12;
const MAX_SUGGESTIONS = 5;

const REVIEW = z.object({
  skipped: z
    .array(
      z.object({
        n: z.number().int().min(1),
        verdict: z.enum(["confirmed", "writable", "unsure"]),
        why: z.string().trim().min(10),
        sources: z.array(z.string().trim().min(1)).default([]),
      }),
    )
    .default([]),
  suggestions: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(60),
        prompt: z.string().trim().min(5).max(600),
        scope: z.enum(["change", "add"]).default("change"),
      }),
    )
    .default([]),
});

export type ReviewReply = { verdicts: Map<number, SkipReview>; suggestions: Suggestion[] };

// ponytail: a reason another look can overturn — an item already tested or stopped by a cancel is settled without one
const looked = (s: Skipped) => !["already-tested", "stopped", "other"].includes(s.reason);

// ponytail: a second look needs an item, a suggestion needs tests to speak of — a generation that wrote nothing and
// left nothing another look can settle has no part at all (reviewPart().part is then never sent)
export function reviewLines(o: { request: string; tests: string[]; skipped: Skipped[]; revised?: boolean }): string[] {
  const items = o.skipped.filter(looked).slice(0, MAX_LOOKED);
  const suggest = o.tests.length > 0;
  const lines = [
    `About the generation ${suggest ? "these tests come from" : "that wrote no test"} (its request: « ${o.request.trim() || "the documents in scope"} »):`,
  ];
  if (items.length)
    lines.push(
      "It left these behaviors without a test. Take a second look at each: search once more — rag_mentions on its terms, rag_related on the passage that asks for it — and say whether the reason holds.",
      ...items.map(
        (s, k) =>
          `${k + 1}. ${s.item} — ${REASON_LABEL[s.reason]}: ${s.why}${s.sources?.length ? ` [${s.sources.join("; ")}]` : ""}`,
      ),
      'verdict "confirmed": the reason holds. "writable": a passage states what the tester must see — cite it as docId#anchor "quote". "unsure": you could not settle it. why: one sentence, in English.',
    );
  if (suggest)
    lines.push(
      `${items.length ? "Then propose" : "Propose"} 3 to ${MAX_SUGGESTIONS} requests the user could ask next about ${o.revised ? "the tests changed" : "these tests"} as a whole — what the generation lacks or could do better, in the documents' terms; never a generic one, never one that asks again for a behavior no passage supports. label: a verb first, at most 32 characters; prompt: one or two sentences telling Claude what to do; scope "add" for new tests, "change" for the tests above. In English.`,
    );
  const block = [
    ...(items.length
      ? [
          '"skipped": [{"n": 1, "verdict": "confirmed | writable | unsure", "why": "…", "sources": ["<docId#anchor \\"quote\\">"]}]',
        ]
      : []),
    ...(suggest ? ['"suggestions": [{"label": "…", "prompt": "…", "scope": "change | add"}]'] : []),
  ];
  lines.push(
    "End your reply with this block, valid JSON, nothing after it:",
    "```" + REVIEW_TAG,
    `{${block.join(", ")}}`,
    "```",
  );
  return lines;
}

/** whether there is anything to say about a generation: an item another look can settle, or tests to speak of */
export const hasReview = (o: { tests: string[]; skipped: Skipped[] }): boolean =>
  o.tests.length > 0 || o.skipped.some(looked);

export function reviewPart(o: { request: string; tests: string[]; skipped: Skipped[]; revised?: boolean }): {
  part: AlsoAsked;
  reply(): ReviewReply | null;
  items: Skipped[];
} {
  const items = o.skipped.filter(looked).slice(0, MAX_LOOKED);
  const ask = reviewLines(o);
  let got: ReviewReply | null = null;
  return {
    items,
    reply: () => got,
    part: {
      id: "generation review",
      size: ask.join("\n").length,
      ask,
      answered(reply) {
        const b = readBlock(reply, REVIEW_TAG, REVIEW);
        if (!b.value) return false;
        const suggestions: Suggestion[] = [];
        for (const s of b.value.suggestions) {
          if (suggestions.some((k) => k.label === s.label)) continue;
          suggestions.push({
            label: s.label,
            prompt: s.prompt,
            ...(s.scope === "add" ? { scope: "add" as const } : {}),
          });
        }
        got = {
          verdicts: new Map(
            b.value.skipped
              .filter((v) => v.n <= items.length)
              .map((v) => [
                v.n,
                { verdict: v.verdict, why: v.why, ...(v.sources.length ? { sources: v.sources } : {}) },
              ]),
          ),
          suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
        };
        return true;
      },
    },
  };
}

// ponytail: « writable » is a claim like any other — it stands only when the passage it cites exists and holds its
// quote; without one it is « unsure »
export function applyReview(skipped: Skipped[], items: Skipped[], reply: ReviewReply, corpus: Corpus): Skipped[] {
  return skipped.map((s) => {
    const n = items.indexOf(s) + 1;
    const v = n ? reply.verdicts.get(n) : undefined;
    if (!v) return s;
    if (v.verdict !== "writable") return { ...s, review: v };
    const sources = (v.sources ?? []).filter((line) => {
      const src = parseSource(line);
      return !!src && !sourceProblem(corpus, src);
    });
    return {
      ...s,
      review: sources.length
        ? { ...v, sources }
        : { verdict: "unsure", why: `${v.why} (the passage it cites could not be found in the documents)` },
    };
  });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function proposeWritable(
  project: string,
  generation: string,
  skipped: Skipped[],
  by: { runId: string; model: string; effort: Effort | "" },
  log: (level: "warn", message: string) => void,
): number {
  let n = 0;
  for (const s of skipped) {
    if (s.review?.verdict !== "writable" || !s.review.sources?.length) continue;
    const head = "Write the test left out: ";
    try {
      proposeAction(project, {
        title: `${head}${clip(s.item, 80 - head.length)}`,
        scope: { kind: "project" },
        where: `gen:${generation}`,
        problem: `No test for « ${s.item} » (${REASON_LABEL[s.reason]}: ${s.why}). A second look found the passage: ${s.review.sources.join("; ")}`,
        why: s.review.why,
        plan: [
          `Read ${s.review.sources.map((x) => x.split(' "')[0]).join(", ")} and what it refers to`,
          "Write the test with tests_create in the generation's folder, that passage as the source of its expected result",
          "Run check_run on the new test: no finding is left",
        ],
        proposedBy: { run: "check", model: by.model, effort: by.effort, at: env.now().toISOString(), runId: by.runId },
        suggest: { model: "opus", effort: "high" },
      });
      n++;
    } catch (e) {
      log("warn", `No Claude action for « ${s.item} »: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return n;
}
