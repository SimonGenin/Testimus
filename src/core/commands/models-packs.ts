import { z } from "zod";
import { command, projectOf, UserError } from "../command.ts";
import { machineProfile } from "../lib/machine/profile.ts";
import { packRows, suggestPack } from "../lib/models-packs.ts";
import { readPerf } from "../lib/models-perf.ts";
import { refdocScore, refdocText } from "../lib/models-quality.ts";
import { adviceList, lighterPack, modelsDeps, planPack, useModels, usePack } from "../lib/models-use.ts";
import { readSettings, writeSettings } from "../lib/project.ts";
import { measureRefdoc } from "../rag/refdoc.ts";
import type { RagChoice } from "../types.ts";
import { choice, fit, modelId, packOut } from "./models-schemas.ts";

export const commands = [
  command({
    name: "models.use",
    summary:
      "Use an embedding and/or a reranker for the open project on this PC (the « Custom » pack); the index job follows when the embedding changes. dryRun says whether it fits and names a lighter model, and changes nothing.",
    input: z.object({
      embedding: z.string().optional().describe("Catalog id of the embedding (default: the one in use)"),
      reranker: z
        .string()
        .nullable()
        .optional()
        .describe("Catalog id of the reranker, or null for none (default: the one in use)"),
      reference: z.boolean().default(false).describe("Also make it the team reference in project.json"),
      dryRun: z.boolean().default(false).describe("Only say whether it fits this PC and what would change"),
    }),
    output: z.object({
      choice: z
        .object({
          embedding: modelId.describe("The embedding"),
          reranker: z.string().nullable().describe("The reranker (null = none)"),
        })
        .describe("The pair now in use (to be used, with dryRun)"),
      fit,
      reindex: z.boolean().describe("The embedding changes, so the documents are indexed again"),
      indexJob: z.string().nullable().describe("The index job started (null with dryRun or when nothing changes)"),
      lighter: z
        .string()
        .nullable()
        .describe("A lighter model of the same kind that fits this PC, for when this one does not (null = none)"),
      dryRun: z.boolean().describe("True when nothing was changed"),
    }),
    mutates: true,
    run: async (ctx, input) => useModels(projectOf(ctx), input),
  }),
  command({
    name: "models.packs",
    summary:
      "The packs, each with the variant it resolves to on this PC, its fit, what is left to download, speed and quality.",
    input: z.object({}),
    output: z.array(
      z
        .object({
          id: z.string().describe("Pack id"),
          label: z.string().describe("Its name in words"),
          intent: z.string().describe("What it is for, in one line"),
          active: z.boolean().describe("The open project uses it on this PC"),
          available: z.boolean().describe("One of its variants can run on this PC"),
          variant: z.number().nullable().describe("Index of the variant that applies here (null = none fits)"),
          embedding: z.string().nullable().describe("That variant's embedding"),
          reranker: z.string().nullable().describe("That variant's reranker (null = none)"),
          fit: fit.nullable(),
          skipped: z.array(z.string()).describe("Why the variants above were skipped, with the numbers"),
          downloadMB: z.number().describe("What is left to download, in MB"),
          speed: z.string().optional().describe("Speed measured on this PC, when the journal knows it"),
          quality: z
            .string()
            .describe(
              "On Testimus's reference document, how often search ranks the answering article first and in the top 5 — measured on this PC, else the catalog's figure measured by Testimus, else « quality not measured yet »",
            ),
          measuredHere: z.boolean().describe("The quality above was measured on this PC (models.measure)"),
          projectQuality: z
            .string()
            .optional()
            .describe("Evidence recall on this project's own behavior set, when rag.eval has measured these models"),
          processorOnly: z
            .boolean()
            .describe("The pack is made for a GPU and here it runs on the processor: several times slower"),
          suggested: z
            .boolean()
            .describe(
              "The pack proposed at first launch: the heaviest that fits, proven on this system, without a GGUF or a processor fallback, else Light",
            ),
          lighter: z
            .string()
            .nullable()
            .describe("The next lighter pack available here, for when this one does not fit (null = none)"),
        })
        .describe("One pack"),
    ),
    mutates: false,
    async run(ctx) {
      const project = projectOf(ctx);
      const rows = await packRows(
        await modelsDeps.activeChoice(project),
        await modelsDeps.queryTask(project),
        {},
        project,
      );
      const suggested = suggestPack(await machineProfile(), readPerf());
      return rows.map((r) => ({ ...r, suggested: r.id === suggested, lighter: lighterPack(rows, r.id) }));
    },
  }),
  command({
    name: "models.planPack",
    summary:
      "What using a pack for the open project takes on this PC: its variant, the downloads and where they go, whether the documents are indexed again, the expected speed. Changes nothing.",
    input: z.object({ pack: z.string().describe("light, performance, balanced, quality") }),
    output: z.object(packOut),
    mutates: false,
    positional: ["pack"],
    run: async (ctx, input) => {
      const { llama: _l, ...p } = await planPack(projectOf(ctx), input.pack);
      return p;
    },
  }),
  command({
    name: "models.usePack",
    summary:
      "Use a pack for the open project on this PC: download what its variant needs, try each download, activate it, start the index job (--download-only stops after the downloads). A job with those steps; models.planPack shows the plan first.",
    input: z.object({
      pack: z.string().describe("light, performance, balanced, quality"),
      reference: z.boolean().default(false).describe("Also make it the team reference in project.json"),
      downloadOnly: z
        .boolean()
        .default(false)
        .describe("Only download what the pack needs; the project keeps its current pack until it is used"),
    }),
    output: z.object({
      ...packOut,
      indexJob: z.string().nullable().describe("The index job started (null when the vectors stay or downloadOnly)"),
    }),
    mutates: true,
    job: "models-usePack",
    positional: ["pack"],
    subject: (i) => i.pack,
    run: async (ctx, input) => usePack(ctx, projectOf(ctx), input),
  }),
  command({
    name: "models.measure",
    summary:
      "Measure a pack (or an embedding + reranker pair) on Testimus's reference document: the Syntec collective agreement, 90 articles, 100 questions with the article that answers each. Gives its quality (evidence recall) and this PC's speed; needs no project. A job.",
    input: z.object({
      pack: z.string().optional().describe("Pack id: light, performance, balanced, quality (its variant for this PC)"),
      embedding: z.string().optional().describe("Catalog id of the embedding, instead of a pack"),
      reranker: z.string().nullable().optional().describe("Catalog id of the reranker with --embedding (none = null)"),
    }),
    output: z.object({
      embedding: modelId.describe("The embedding measured"),
      reranker: z.string().nullable().describe("The reranker measured (null = none)"),
      first: z.number().describe("Share of the reference questions whose answering article search ranks first"),
      top5: z.number().describe("Share whose answering article is in the top 5"),
      questions: z.number().describe("Questions asked"),
      quality: z.string().describe("The result in words, as the pack card shows it"),
      report: z.string().describe("Where the report was saved (in this PC's copy of the reference document)"),
    }),
    mutates: false,
    global: true,
    job: "models-measure",
    positional: ["pack"],
    subject: (i) => i.pack ?? i.embedding ?? "pack",
    async run(ctx, input) {
      const choice: RagChoice | null = input.pack
        ? { pack: input.pack }
        : input.embedding
          ? { embedding: input.embedding, reranker: input.reranker ?? null }
          : null;
      if (!choice) throw new UserError("Say what to measure.", "Give a pack (light, …) or --embedding <catalog id>.");
      const report = await measureRefdoc(ctx, choice);
      const s = refdocScore(report) ?? { first: 0, top5: 0, questions: 0 };
      return {
        embedding: report.config.embedding,
        reranker: report.config.reranker,
        ...s,
        quality: refdocText(s, "this PC"),
        report: report.report,
      };
    },
  }),
  command({
    name: "models.advice",
    summary: "Upgrade or downgrade suggestions from the timings, the fit and the benchmark; never switches by itself.",
    input: z.object({}),
    output: z.array(
      z
        .object({
          id: z.string().describe("Advice id (for models.dismissAdvice)"),
          direction: z.enum(["upgrade", "downgrade"]).describe("To a heavier or a lighter choice"),
          from: choice.describe("What the project uses"),
          to: choice.describe("What it suggests"),
          reason: z.string().describe("Why, with the numbers measured on this PC"),
          quality: z.string().describe("What it changes to search quality, when measured"),
        })
        .describe("One advice"),
    ),
    mutates: false,
    async run(ctx) {
      return (await adviceList(projectOf(ctx))).map(({ metric: _m, ...a }) => a);
    },
  }),
  command({
    name: "models.dismissAdvice",
    summary: "Dismiss an advice; it comes back only when its numbers change by more than 25 %.",
    input: z.object({ id: z.string().describe("Advice id from models.advice") }),
    output: z.object({ dismissed: z.string().describe("The advice dismissed") }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const hit = (await adviceList(projectOf(ctx))).find((a) => a.id === input.id);
      if (!hit) throw new UserError(`No current advice ${input.id}.`, "testimus models advice lists them.");
      const s = readSettings();
      writeSettings({ ...s, rag: { ...s.rag, dismissed: { ...s.rag?.dismissed, [hit.id]: String(hit.metric) } } });
      return { dismissed: hit.id };
    },
  }),
];
