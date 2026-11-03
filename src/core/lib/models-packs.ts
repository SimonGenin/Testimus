import { publishedMeasure, refdocDir } from "../rag/refdoc.ts";
import type { ActiveChoice, CatalogEntry, Fit, MachineProfile, PerfLine } from "../types.ts";
import { PACK_ORDER } from "./models-advice.ts";
import { catalog, catalogEntry } from "./models-catalog.ts";
import { deviceFor, fitOf } from "./models-fit.ts";
import { perfStats, variantSpeed } from "./models-perf.ts";
import { evalReports, type Measured, NOT_MEASURED, packQuality, refdocQuality } from "./models-quality.ts";
import { budgets, readRegistry } from "./models-registry.ts";
import { DEFAULT_QUERY_TASK, type Resolution, type ResolveDeps, resolveChoice } from "./models-resolve.ts";

export type PackRow = {
  id: string;
  label: string;
  intent: string;
  active: boolean;
  available: boolean;
  variant: number | null;
  embedding: string | null;
  reranker: string | null;
  fit: Fit | null;
  skipped: string[];
  downloadMB: number;
  speed?: string;
  quality: string;
  measuredHere: boolean;
  projectQuality?: string;
};

export type UsePlan = {
  download: { model: string; sizeMB: number }[];
  dir: string | null;
  reindex: boolean;
  expected: string;
};

export function downloadMBOf(r: Resolution): number {
  return r.missing.reduce((a, id) => a + (catalogEntry(id)?.size.downloadMB ?? 0), 0);
}

export async function packRows(
  active: ActiveChoice | null,
  queryTask = DEFAULT_QUERY_TASK,
  deps: ResolveDeps = {},
  project?: string,
  reports: Measured[] = project ? evalReports(project) : [],
  refReports: Measured[] = evalReports(refdocDir()),
): Promise<PackRow[]> {
  const stats = perfStats({ last: 50, lines: deps.lines });
  const rows: PackRow[] = [];
  for (const p of catalog().packs) {
    const r = await resolveChoice({ pack: p.id }, queryTask, deps);
    const speed = r.variant ? variantSpeed(r.variant.embedding, r.variant.reranker, stats) : undefined;
    const ref = r.variant
      ? refdocQuality(r.variant, refReports, publishedMeasure(p.id, r.variant.embedding, r.variant.reranker))
      : { text: NOT_MEASURED, here: false };
    const own = r.variant ? packQuality(r.variant, reports) : NOT_MEASURED;
    rows.push({
      id: p.id,
      label: p.label,
      intent: p.intent,
      active: !!active && "pack" in active && active.pack === p.id,
      available: !!r.variant,
      variant: r.variantIndex,
      embedding: r.variant?.embedding ?? null,
      reranker: r.variant?.reranker ?? null,
      fit: r.fit ?? null,
      skipped: r.variant ? r.skipped : r.skipped.length ? r.skipped : ["not available on this PC"],
      downloadMB: downloadMBOf(r),
      ...(speed ? { speed } : {}),
      quality: ref.text,
      measuredHere: ref.here,
      ...(own !== NOT_MEASURED ? { projectQuality: own } : {}),
    });
  }
  return rows;
}

export function planOf(r: Resolution, current: ActiveChoice | null): UsePlan {
  const same =
    !!current?.variant &&
    !!r.variant &&
    current.variant.embedding === r.variant.embedding &&
    current.variant.reranker === r.variant.reranker;
  const sameCustom =
    !!current &&
    "embedding" in current &&
    r.variant?.embedding === current.embedding &&
    r.variant?.reranker === current.reranker;
  const speed = r.variant ? variantSpeed(r.variant.embedding, r.variant.reranker, perfStats({ last: 50 })) : undefined;
  return {
    download: r.missing.map((id) => ({ model: id, sizeMB: catalogEntry(id)?.size.downloadMB ?? 0 })),
    dir: readRegistry().dir ?? null,
    reindex: !(same || sameCustom),
    expected: speed ?? "not measured on this PC yet",
  };
}

function fitsAlone(entries: CatalogEntry[], machine: MachineProfile, lines?: PerfLine[]): boolean {
  return fitOf(entries, machine, { headroom: budgets().headroom, lines }).verdict === "fits";
}

export function suggestPack(machine: MachineProfile | null, lines: PerfLine[] = []): string {
  if (!machine?.ramTotalMB) return "light";
  const packs = catalog().packs;
  for (const id of PACK_ORDER) {
    const p = packs.find((x) => x.id === id);
    if (!p) continue;
    for (const v of p.variants) {
      const entries = [v.embedding, v.reranker]
        .filter((m): m is string => !!m)
        .map((m) => catalogEntry(m))
        .filter((e): e is CatalogEntry => !!e);
      // ponytail: a reranker on the processor makes each query take seconds; it stays a choice, never the suggestion
      const slowOnCpu = entries.some(
        (e) => (!e.runtimes.includes("transformers") || e.kind === "reranker") && deviceFor(e, machine) === "cpu",
      );
      if (!slowOnCpu && fitsAlone(entries, machine, lines)) return p.id;
    }
  }
  return "light";
}
