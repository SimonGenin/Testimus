import { env } from "../env.ts";
import { perfFields, perfScope, timeOp, withPerfScope } from "../lib/models-perf.ts";
import type { EmbedMode, ResolvedModel, RuntimeId } from "../types.ts";
import { activeModels } from "./activation.ts";
import { spaceId } from "./db.ts";
import { fingerprintOf } from "./fingerprint.ts";
import { llamacppRuntime } from "./runtimes/llamacpp.ts";
import { mockRuntime } from "./runtimes/mock.ts";
import { transformersRuntime } from "./runtimes/transformers.ts";
import type { Runtime } from "./runtimes/types.ts";
import type { SearchOpts } from "./search/filter.ts";

export type { EmbedMode } from "../types.ts";
export { fakeRerank, fakeVector } from "./runtimes/mock.ts";
export type { Runtime } from "./runtimes/types.ts";
export { words } from "./search/lexical.ts";

export const runtimes: Record<RuntimeId, Runtime> = {
  transformers: transformersRuntime,
  llamacpp: llamacppRuntime,
  mock: mockRuntime,
};

export function runtimeOf(m: ResolvedModel): Runtime {
  return runtimes[env.mock ? "mock" : m.runtime];
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
