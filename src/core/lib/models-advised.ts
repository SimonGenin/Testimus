import type { CatalogEntry, Fit, MachineProfile, PerfLine } from "../types.ts";
import { deviceFor } from "./fit/placement.ts";
import { fitOf, releaseOurs } from "./fit/verdict.ts";
import { catalogEntry } from "./models-catalog.ts";
import { suggestedVariant } from "./models-packs.ts";
import { budgets } from "./models-registry.ts";

export type OneByOne = { advised: boolean; reason: string | null; pair: Fit | null; aside: string | null };

export const BOTH_ON_PROCESSOR =
  "Not offered while the embedding runs on the processor: every query would wait for both.";

// The search models one by one, as Settings › Models shows them: the embedding and the reranker advised for this PC
// (those of the pack proposed here) with why, and each reranker held against the embedding it would run beside — they
// share the card, and one on the processor beside an embedding on the processor is not offered
export function oneByOne(
  machine: MachineProfile,
  beside: string | null,
  lines: PerfLine[] = [],
): (entry: CatalogEntry) => OneByOne {
  const opts = { headroom: budgets().headroom, lines };
  const free = releaseOurs(machine);
  const { variant } = suggestedVariant(machine, lines);
  const advisedEmbedding = catalogEntry(variant.embedding);
  const embedding = beside ? catalogEntry(beside) : undefined;
  const embeddingOnCpu = !!embedding && deviceFor(embedding, machine) === "cpu";
  return (entry) => {
    if (entry.kind === "embedding") {
      const advised = entry.id === variant.embedding;
      return { advised, reason: advised ? fitOf([entry], free, opts).message : null, pair: null, aside: null };
    }
    if (entry.kind !== "reranker") return { advised: false, reason: null, pair: null, aside: null };
    const advised = entry.id === variant.reranker && !!advisedEmbedding;
    return {
      advised,
      reason: advised && advisedEmbedding ? fitOf([advisedEmbedding, entry], free, opts).message : null,
      pair: embedding ? fitOf([embedding, entry], machine, opts) : null,
      aside: embeddingOnCpu && deviceFor(entry, machine) === "cpu" ? BOTH_ON_PROCESSOR : null,
    };
  };
}
