import { z } from "zod";
import { SKIP_REASONS } from "../claude/gen-reply.ts";
import { DIAGNOSIS, TOKENS } from "../claude/schemas.ts";

// ponytail: the shapes the generation commands share — what a generation answers, what it left out, its plan

export const SKIPPED = z.object({
  item: z.string().describe("The behavior left without a test"),
  reason: z
    .enum(SKIP_REASONS)
    .describe(
      "Why, from a closed list: no-source (no passage states what the tester must see), not-observable, already-tested, out-of-scope, documents-disagree, missing-material (what would state it is not in the project), stopped (the run was cut short); other for a report older than the list",
    ),
  category: z
    .string()
    .describe("The words the items are grouped under: the reason's, or Claude's own in an older report"),
  why: z.string().describe("Why no test for this item, concretely"),
  sources: z.array(z.string()).optional().describe('The passages that ask for it, docId#anchor "quote"'),
  searched: z.array(z.string()).optional().describe("What the run searched before giving up, as it said"),
  read: z.array(z.string()).optional().describe("The passages it opened for the item, docId#anchor"),
  unblock: z.string().optional().describe("What would let the test be written, and who can bring it"),
  test: z.string().optional().describe("already-tested: the test that verifies it"),
  doubts: z
    .array(z.string())
    .optional()
    .describe(
      "What Testimus could not confirm about it, without a model: a source that does not hold its quote, a passage said read and never opened, no search before giving up, a test that does not exist",
    ),
  review: z
    .object({
      verdict: z
        .enum(["confirmed", "writable", "unsure"])
        .describe("confirmed: the reason holds · writable: a passage states what the tester must see · unsure"),
      why: z.string().describe("Why, in one sentence"),
      sources: z.array(z.string()).optional().describe("writable: the passage found, checked by Testimus"),
    })
    .optional()
    .describe("The second look Claude took at the item while checking the tests; absent when none was taken"),
});

export const PLANNED_TEST = z.object({
  summary: z.string().trim().min(3).describe("The test's summary, without its theme"),
  technique: z.string().default("").describe("The test technique, in a few words"),
  sections: z.array(z.string()).default([]).describe("The docId#§x.y the test is written from"),
  theme: z.string().optional().describe("The theme it is filed under: the sub-folder it is written to"),
  off: z.boolean().optional().describe("true: unticked, not written"),
});

export const QUESTION = z.object({
  id: z.string().min(1).describe("Its id in the plan (q1…): answers name it"),
  text: z.string().describe("The question"),
  why: z.string().default("").describe("Why it must be settled before writing"),
  sources: z.array(z.string()).default([]).describe('The passages that raise it: docId#anchor "quote"'),
  answers: z.array(z.string()).default([]).describe("The answers Claude proposes"),
});

export const SETTLED = z.object({
  id: z.string().describe("The question's id when it was asked"),
  text: z.string().describe("The question"),
  answer: z.string().describe("The user's answer: every run of the writing holds to it"),
});

export const GEN_RESULT = z.object({
  runId: z.string().describe("Claude run id — claude.revert removes the tests it wrote"),
  ok: z.boolean().describe("Whether the generation finished"),
  summary: z.string().describe("Claude's final reply"),
  tests: z.array(z.string()).describe("Ids of the new tests (review: draft, generated_by: this job)"),
  checks: z
    .array(
      z.object({
        id: z.string().describe("Test id"),
        ok: z.boolean().describe("False when its semantic check did not finish"),
        review: z.string().describe("Its review state after the check"),
        errors: z.number().describe("Errors found"),
        warnings: z.number().describe("Warnings found"),
      }),
    )
    .describe("The check of each new test (empty with check: false)"),
  changed: z.array(z.string()).describe("Existing tests the run changed although it should not have"),
  discarded: z.array(z.string()).describe("Tests deleted before the run (discard: true)"),
  skipped: z.array(SKIPPED).describe("What the request asked for that no test was written for, and why"),
  reportFound: z
    .boolean()
    .describe("Whether every run's report could be read; false: what a run left without a test is not known"),
  reportErrors: z.array(z.string()).optional().describe("Why a report could not be read, when one could not"),
  consulted: z
    .number()
    .describe(
      "How many passages (docId#anchor) the run actually opened, read from its tool calls; the list is in .testimus/gen/<job>.json",
    ),
  planned: z
    .number()
    .describe(
      "Tests written from a plan (plan-tests skill), one Claude run each, several at a time, when the request took more than one test; 0 otherwise",
    ),
  generation: z
    .string()
    .describe("The generation id: generated_by of its tests, its ledger .testimus/gen/<id>.json, what resume takes"),
  remaining: z
    .number()
    .describe("Planned tests not written (cancelled, or a failed run), also listed in skipped: resume writes them"),
  costUsd: z.number().optional().describe("What the runs cost"),
  tokens: TOKENS.optional(),
  durationMs: z.number().describe("How long the generation took"),
  diagnosis: DIAGNOSIS.optional(),
  state: z
    .literal("planned")
    .optional()
    .describe(
      "planned: the job ended with the plan (review), nothing written — gen.show shows it, gen.write writes it",
    ),
});
