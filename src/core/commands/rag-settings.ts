import { z } from "zod";
import { claudeHeaders } from "../claude/headers.ts";
import { command, projectOf } from "../command.ts";
import { readProject, writeProject } from "../lib/project.ts";
import { activeModels } from "../rag/activation.ts";
import { compare } from "../rag/compare.ts";
import { runEval } from "../rag/eval.ts";
import { glossaryOf } from "../rag/glossary.ts";
import { policy, retrievalOverride, retrievalSettings, searchMode } from "../rag/schemas.ts";
import {
  retrievalSettings as effective,
  mergeRetrieval,
  projectRetrieval,
  RETRIEVAL_DEFAULTS,
  type RetrievalOverride,
} from "../rag/search/hybrid.ts";

const settingsOut = z.object({
  defaults: retrievalSettings.describe("Testimus's defaults"),
  pack: retrievalOverride.nullable().describe("What the pack in use on this PC sets over the defaults; null: nothing"),
  base: retrievalSettings.describe(
    "The defaults with the pack's settings: what « Reset ranking » gives the ranking back to",
  ),
  project: retrievalOverride
    .nullable()
    .describe("project.json rag.retrieval, shared with the team; null: the project sets nothing"),
  effective: retrievalSettings.describe("What a search runs with: defaults < the pack < project.json"),
  reranker: z
    .string()
    .nullable()
    .describe("The reranker in use on this PC (catalog id); null: none, the reranker settings do nothing"),
  glossary: z
    .object({
      documents: z.number().describe("Acronyms read from the documents' glossary sections"),
      project: z.number().describe("Acronyms of project.json glossary"),
    })
    .describe("The acronyms a query is expanded with, beside the synonyms"),
});

async function settingsOf(project: string): Promise<z.infer<typeof settingsOut>> {
  const active = await activeModels(project).catch(() => null);
  const pack = (active?.retrieval as RetrievalOverride | undefined) ?? null;
  const glossary = glossaryOf(project);
  const own = glossary.filter((g) => g.source === "project.json").length;
  return {
    defaults: RETRIEVAL_DEFAULTS,
    pack,
    base: mergeRetrieval(RETRIEVAL_DEFAULTS, pack ?? undefined),
    project: projectRetrieval(project) ?? null,
    effective: effective(project, undefined, pack ?? undefined),
    reranker: active?.reranker?.entry.id ?? null,
    glossary: { documents: glossary.length - own, project: own },
  };
}

// ponytail: synonyms written as typed, each group without blanks or repeats, a group of one word dropped
function tidy(r: RetrievalOverride): RetrievalOverride {
  if (!r.synonyms) return r;
  const synonyms = r.synonyms
    .map((g) => [...new Set(g.map((t) => t.trim()).filter(Boolean))])
    .filter((g) => g.length >= 2);
  return { ...r, synonyms };
}

// ponytail: a save never rewrites what it did not change — a colleague's key, or one this PC's pack happens to
// match, stays in project.json
function patched(saved: RetrievalOverride, over: RetrievalOverride, unset: string[]): RetrievalOverride {
  const next: Record<string, unknown> = { ...saved, ...over };
  if (over.rerank) next.rerank = { ...saved.rerank, ...over.rerank };
  for (const key of unset) delete next[key];
  return next as RetrievalOverride;
}

const measured = z.object({
  report: z.string().describe("Its report under .testimus/eval/"),
  setting: z.string().describe("Its configuration name"),
  recall: z.number().describe("Must-evidence recall at k"),
});

export const commands = [
  command({
    name: "rag.retrieval",
    summary:
      "The retrieval settings: Testimus's defaults, what the pack in use sets, project.json rag.retrieval, and what a search runs with.",
    input: z.object({}),
    output: settingsOut,
    mutates: false,
    run: (ctx) => settingsOf(projectOf(ctx)),
  }),
  command({
    name: "rag.setRetrieval",
    summary:
      "Change project.json rag.retrieval (shared with the team): the keys given are written over what it holds, the keys in unset are taken out (back to the pack's or the default), the others stay; null takes it all out.",
    input: z.object({
      retrieval: retrievalOverride
        .nullable()
        .describe(
          "The keys to write (candidates, rrfK, bm25Weights, rrfWeights, rerank, expand, typos, synonyms; rerank's own keys merge with the saved ones); a key left out keeps what project.json holds; null takes everything out",
        ),
      unset: z
        .array(retrievalOverride.keyof())
        .default([])
        .describe("Keys taken out of project.json rag.retrieval: they go back to the pack's or the default"),
    }),
    output: settingsOut,
    mutates: true,
    async run(ctx, input) {
      const dir = projectOf(ctx);
      const p = readProject(dir);
      const rag = { ...p.rag };
      const next = input.retrieval ? patched(rag.retrieval ?? {}, tidy(input.retrieval), input.unset) : null;
      if (next && Object.keys(next).length) rag.retrieval = next as typeof rag.retrieval;
      else delete rag.retrieval;
      writeProject(dir, { ...p, rag });
      return settingsOf(dir);
    },
  }),
  command({
    name: "rag.measure",
    summary:
      "Measure retrieval settings on the project's benchmark before keeping them: rag.eval with the saved settings, rag.eval with these, and rag.compare of the two (paired bootstrap, adopt rule).",
    input: z.object({
      retrieval: retrievalOverride.describe("The settings to try, over the saved ones (as rag.eval --retrieval)"),
      set: z.string().optional().describe("Behavior set, relative to the project (default eval/behaviors.jsonl)"),
      k: z.number().int().min(1).max(50).default(10).describe("Rank cut-off of the recall compared"),
      mode: searchMode,
      policy: policy.default("search").describe("Policy compared (default search: what the settings change most)"),
    }),
    output: z.object({
      baseline: measured.describe("The saved settings"),
      candidate: measured.describe("The settings tried"),
      k: z.number().describe("Rank cut-off of the recall compared"),
      policy,
      n: z.number().describe("Behaviors paired"),
      diff: z.number().describe("Mean paired difference in must-evidence recall (candidate − baseline)"),
      low: z.number().describe("Bootstrap 95 % interval, lower bound"),
      high: z.number().describe("Bootstrap 95 % interval, upper bound"),
      adopt: z
        .boolean()
        .describe("The interval is above zero and no role goes down: the settings may become the default"),
      why: z.string().describe("The adopt rule's verdict, in words"),
      provisional: z.boolean().describe("The behavior set is not validated by the testers"),
      byRole: z
        .record(
          z.string(),
          z.object({
            recall: z.number().describe("Recall of this role with the settings tried"),
            baseline: z.number().describe("With the saved settings"),
            diff: z.number().describe("Difference"),
            n: z.number().describe("Evidence items of this role"),
          }),
        )
        .describe("By evidence role"),
    }),
    mutates: true,
    job: "rag-measure",
    subject: () => "retrieval",
    async run(ctx, input) {
      const dir = projectOf(ctx);
      ctx.steps?.([
        { id: "saved", label: "The saved settings" },
        { id: "tried", label: "The settings tried" },
      ]);
      ctx.step?.("saved");
      const base = await runEval(dir, ctx, { set: input.set, k: input.k, mode: input.mode, describe: claudeHeaders });
      ctx.step?.("tried");
      const tried = await runEval(dir, ctx, {
        set: input.set,
        k: input.k,
        mode: input.mode,
        retrieval: input.retrieval,
        describe: claudeHeaders,
      });
      const row = compare(base, [tried], { k: input.k, policy: input.policy }).rows[0];
      return {
        baseline: { report: base.report, setting: base.setting, recall: row.baseline },
        candidate: { report: tried.report, setting: tried.setting, recall: row.recall },
        k: input.k,
        policy: input.policy,
        n: row.n,
        diff: row.diff,
        low: row.low,
        high: row.high,
        adopt: row.adopt,
        why: row.why,
        provisional: row.provisional,
        byRole: row.byRole,
      };
    },
  }),
];
