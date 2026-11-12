import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { claudeHeaders } from "../claude/headers.ts";
import { EFFORT, MODEL, NOTE } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { docsFreshness, indexAfterConversions, indexRunOf } from "../lib/docs-index.ts";
import { embedPlace, embedPlaceText } from "../lib/fit/placement.ts";
import { machineProfile } from "../lib/machine/profile.ts";
import { activeModels } from "../rag/activation.ts";
import { chunkCount, dropSpace, getMeta, listSpaces, vectorCount, withIndex } from "../rag/db.ts";
import { dimsOf, spaceOf } from "../rag/fingerprint.ts";
import { indexProject, readState } from "../rag/indexer.ts";
import type { VectorSpace } from "../types.ts";

const space = z.object({
  id: z.string().describe("12 hex characters: sha256 of the space's fingerprint"),
  model: z.string().describe("Catalog id of the embedding model"),
  runtime: z.string().describe("Runtime that computed the vectors: transformers, llamacpp or mock"),
  dims: z.number().describe("Vector dimension"),
  chunks: z.number().describe("Vectors stored in this space"),
  complete: z.boolean().describe("Every current chunk has a vector in this space"),
  active: z.boolean().describe("The space this PC uses for the open project"),
  builtAt: z.string().nullable().describe("When the space was last completed"),
  lastUsed: z.string().nullable().describe("When the space was last filled"),
  sizeMB: z.number().describe("Approximate size of its vectors (vectors × dims × 4 bytes)"),
});

function sizeMB(db: DatabaseSync, s: VectorSpace): number {
  return Math.round((vectorCount(db, s.id) * s.dims * 4) / 1e4) / 100;
}

const NO_MODEL = "No embedding model is installed on this PC: lexical search only.";

export const commands = [
  command({
    name: "rag.index",
    summary:
      "Build or update the project's search index from docs/: chunks, BM25 and the graph once, then the vectors the active model's space lacks.",
    input: z.object({
      force: z.boolean().default(false).describe("Rebuild everything instead of only what changed"),
      model: MODEL.optional().describe(
        "Claude model for the context headers, when project.json rag.claudeHeaders is on (default: haiku)",
      ),
      effort: EFFORT.optional().describe("Claude effort for the context headers (default: low)"),
      note: NOTE,
    }),
    output: z.object({
      embedding: z.string().describe("Catalog id of the embedding model used, or none"),
      dims: z.number().describe("Dimension of the vector space, 0 without a model"),
      vectorsRebuilt: z.boolean().describe("The space was empty before this run"),
      space: z.string().optional().describe("Id of the vector space filled by this run"),
      degraded: z.string().optional().describe("Why no vectors were built (no embedding model installed here)"),
      docs: z
        .array(
          z.object({
            docId: z.string().describe("Document id"),
            status: z.enum(["indexed", "unchanged", "removed"]).describe("What this run did to the document"),
            chunks: z.number().describe("Passages of the document in the index"),
          }),
        )
        .describe("One line per document"),
      chunks: z.number().describe("Passages in the index"),
      embedded: z.number().describe("Passages embedded by this run"),
      ms: z.number().describe("Duration in milliseconds"),
    }),
    mutates: true,
    job: "rag-index",
    subject: () => "index",
    run: (ctx, { force, model, effort, note }) => {
      const project = projectOf(ctx);
      const claude = { model, effort, note };
      return indexAfterConversions(
        project,
        () => indexProject(project, ctx, { force, claude, describe: claudeHeaders }),
        {
          signal: ctx.signal,
          waiting: (message) => ctx.progress({ message }),
        },
      );
    },
  }),
  command({
    name: "rag.status",
    summary:
      "The index's state: the embedding model this PC uses and its vector space, chunk count, and whether each document is indexed and fresh.",
    input: z.object({}),
    output: z.object({
      embedding: z.string().describe("Catalog id of the embedding model active on this PC, or none"),
      reranker: z.string().nullable().describe("Catalog id of the active reranker, or null"),
      dims: z.number().describe("Dimension of the active model, 0 without one"),
      embeddingPlace: z
        .object({
          where: z.enum(["gpu", "cpu"]).describe("gpu: the graphics card computes the vectors; cpu: the processor"),
          engine: z
            .enum(["onnxruntime", "llama.cpp"])
            .describe("onnxruntime: in the embed worker, a Node process of its own; llama.cpp: in its llama-server"),
          threads: z
            .number()
            .nullable()
            .describe("Processor threads the embed worker uses (the PC's less two), null on the card or in llama.cpp"),
          text: z
            .string()
            .describe("What Settings › Models says, e.g. Embedding: processor, 22 cores, separate process"),
        })
        .nullable()
        .describe("Where the active embedding model runs on this PC, null without one"),
      activation: z
        .enum(["machine", "reference", "light", "none"])
        .describe(
          "Where the active models come from: this PC's choice, the project's reference, the Light pack, or none (BM25 only)",
        ),
      missing: z
        .array(z.string())
        .describe(
          "Models of the choice the project wants (this PC's, else the reference, else Light) that are not on this PC — never those of a fallback; « pack <id> » when that pack has no variant here",
        ),
      exists: z.boolean().describe("index/rag.db exists"),
      indexEmbedding: z.string().nullable().describe("Model the index was last embedded with"),
      profileMatches: z.boolean().describe("The active model's vector space exists and is complete"),
      space: z
        .object({
          id: z.string().describe("Space id"),
          vectors: z.number().describe("Vectors stored"),
          complete: z.boolean().describe("Every chunk has a vector"),
        })
        .nullable()
        .describe("The active vector space, null when it does not exist yet"),
      degraded: z.string().nullable().describe("Why hybrid search falls back to BM25 on this PC, or null"),
      indexing: z
        .object({
          state: z
            .enum(["running", "waiting"])
            .describe("running: an index run is under way; waiting: one is asked for and waits its turn"),
          doc: z.number().describe("Documents the run has started on (the one it reads now included)"),
          docs: z.number().describe("Documents the run reads: those not fresh"),
          done: z.number().describe("Passages embedded by the run so far"),
          total: z.number().describe("Passages the run embeds (0 until it starts embedding)"),
        })
        .nullable()
        .describe(
          "The index run under way or waiting, null when none: until it ends, degraded and the documents' stale or missing states are its work in progress, not problems",
        ),
      chunks: z.number().describe("Passages in the index"),
      builtAt: z.string().nullable().describe("Last rag.index run"),
      docs: z
        .array(
          z.object({
            docId: z.string().describe("Document id"),
            indexed: z.enum(["fresh", "stale", "missing"]).describe("Index state of the document"),
          }),
        )
        .describe("One line per document"),
    }),
    mutates: false,
    run: async (ctx) => {
      const project = projectOf(ctx);
      const active = await activeModels(project);
      const m = active.embedding;
      const found = withIndex(project, null, (db) => {
        const s = m ? spaceOf(db, m) : undefined;
        return {
          indexEmbedding: getMeta(db, "embedding") ?? null,
          chunks: chunkCount(db),
          space: s ? { id: s.id, vectors: vectorCount(db, s.id), complete: s.complete } : null,
        };
      });
      const space = found?.space ?? null;
      const profileMatches = !!space?.complete;
      const degraded = !m
        ? NO_MODEL
        : !space
          ? `No vectors for ${m.entry.id} yet: run rag index.`
          : !space.complete
            ? `The vectors of ${m.entry.id} are incomplete: run rag index.`
            : null;
      const state = readState(project);
      const docs = await docsFreshness(project);
      const place = m ? embedPlace(m, await machineProfile().catch(() => null)) : null;
      return {
        embedding: m?.entry.id ?? "none",
        reranker: active.reranker?.entry.id ?? null,
        dims: m ? dimsOf(m) : 0,
        embeddingPlace: place ? { ...place, text: embedPlaceText(place) } : null,
        activation: active.source,
        missing: active.missing,
        exists: found !== null,
        indexEmbedding: found?.indexEmbedding ?? null,
        profileMatches,
        space,
        degraded,
        indexing: indexRunOf(project, docs),
        chunks: found?.chunks ?? 0,
        builtAt: state?.builtAt ?? null,
        docs: docs.map((d) => ({ docId: d.id, indexed: d.indexed })),
      };
    },
  }),
  command({
    name: "rag.spaces",
    summary: "The vector spaces of the project's index: model, size, complete, active on this PC, last used.",
    input: z.object({}),
    output: z.array(space),
    mutates: false,
    run: async (ctx) => {
      const project = projectOf(ctx);
      const m = (await activeModels(project)).embedding;
      return withIndex(project, [], (db) => {
        const active = m ? spaceOf(db, m)?.id : undefined;
        return listSpaces(db).map((s) => ({
          id: s.id,
          model: s.modelId,
          runtime: s.fingerprint.runtime,
          dims: s.dims,
          chunks: vectorCount(db, s.id),
          complete: s.complete,
          active: s.id === active,
          builtAt: s.builtAt,
          lastUsed: s.lastUsed,
          sizeMB: sizeMB(db, s),
        }));
      });
    },
  }),
  command({
    name: "rag.dropSpace",
    summary: "Delete one vector space from the index (never the active one unless force).",
    input: z.object({
      id: z.string().min(4).describe("Space id from rag.spaces (a unique prefix is enough)"),
      force: z
        .boolean()
        .default(false)
        .describe("Also drop the active space (search falls back to BM25 until reindexed)"),
    }),
    output: z.object({
      dropped: z.string().describe("Id of the dropped space"),
      freedMB: z.number().describe("Approximate size of the vectors removed"),
    }),
    mutates: true,
    positional: ["id"],
    run: async (ctx, input) => {
      const project = projectOf(ctx);
      const m = (await activeModels(project)).embedding;
      const out = withIndex(project, null, (db) => {
        const hits = listSpaces(db).filter((s) => s.id.startsWith(input.id.toLowerCase()));
        if (hits.length !== 1)
          throw new UserError(
            hits.length ? `${input.id} matches ${hits.length} spaces.` : `No vector space ${input.id} in the index.`,
            "Give more characters of the id (testimus rag spaces).",
          );
        const s = hits[0];
        if (!input.force && m && spaceOf(db, m)?.id === s.id)
          throw new UserError(
            `${s.id} is the space this PC searches with (${s.modelId}).`,
            "Activate another model first, or pass --force (search falls back to BM25 until reindexed).",
          );
        const freedMB = sizeMB(db, s);
        dropSpace(db, s.id);
        db.exec("vacuum");
        return { dropped: s.id, freedMB };
      });
      if (!out) throw new UserError("The project has no index yet.", "Run testimus rag index.");
      return out;
    },
  }),
];
