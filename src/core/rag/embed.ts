import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { perfFields, perfScope, timeOp, withPerfScope } from "../lib/models-perf.ts";
import type { EmbedMode, ResolvedModel, RuntimeId } from "../types.ts";
import { activeModels } from "./activation.ts";
import { spaceId } from "./db.ts";
import { fingerprintOf } from "./fingerprint.ts";
import { transformersProcessRuntime } from "./runtimes/embed-process.ts";
import { llamacppRuntime } from "./runtimes/llamacpp.ts";
import { mockRuntime } from "./runtimes/mock.ts";
import type { Runtime } from "./runtimes/types.ts";
import type { SearchOpts } from "./search/filter.ts";

// ponytail: the runtime of each kind of model; tests put a counting or failing runtime here (no real model runs in a
// unit test, and env has no seam for it), --mock serves every model from the mock one
export const runtimes: Record<Exclude<RuntimeId, "whispercpp">, Runtime> = {
  transformers: transformersProcessRuntime,
  llamacpp: llamacppRuntime,
  mock: mockRuntime,
};

function runtimeOf(m: ResolvedModel): Runtime {
  if (env.mock) return runtimes.mock;
  if (m.runtime === "whispercpp")
    throw new UserError(
      `${m.entry.label} is a transcription model: it hears videos, it neither embeds nor reranks.`,
      "Choose an embedding or a reranker model for the search (testimus models catalog).",
    );
  return runtimes[m.runtime];
}

function spaceOfModel(m: ResolvedModel): string | undefined {
  try {
    return spaceId(fingerprintOf(m));
  } catch {
    return undefined;
  }
}

export function embedWith(m: ResolvedModel, texts: string[], mode: EmbedMode): Promise<Float32Array[]> {
  const run = () =>
    timeOp(mode === "query" ? "embed.query" : "embed.index", perfFields(m), texts.length, () =>
      runtimeOf(m).embed(m, texts, mode),
    );
  return perfScope().fingerprint ? run() : withPerfScope({ fingerprint: spaceOfModel(m) }, run);
}

export function rerankWith(m: ResolvedModel, query: string, texts: string[]): Promise<number[]> {
  return timeOp("rerank", perfFields(m), texts.length, () => runtimeOf(m).rerank(m, query, texts));
}

export function probeWith(m: ResolvedModel): Promise<{ dims: number; maxTokens: number }> {
  return runtimeOf(m).probe(m);
}

export async function rerankerFor(project: string, opts: SearchOpts): Promise<ResolvedModel | null> {
  if (opts.reranker === null) return null;
  return (await activeModels(project)).reranker;
}

export async function rerankFor(
  project: string,
  opts: SearchOpts,
  query: string,
  texts: string[],
): Promise<{ model: string; scores: number[] } | null> {
  const m = await rerankerFor(project, opts);
  if (!m) return null;
  return { model: m.entry.id, scores: await rerankWith(m, query, texts) };
}
