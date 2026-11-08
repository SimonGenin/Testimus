import { publishedMeasure, refdocDir } from "../rag/refdoc.ts";
import type {
  ActiveChoice,
  CatalogEntry,
  Fit,
  MachineProfile,
  Pack,
  PackVariant,
  PerfLine,
  RagChoice,
} from "../types.ts";
import { deviceFor, isGguf, onIntegratedGpu } from "./fit/placement.ts";
import { fitOf, releaseOurs } from "./fit/verdict.ts";
import { machineProfile } from "./machine/profile.ts";
import { PACK_ORDER } from "./models-advice.ts";
import { catalog, catalogEntry } from "./models-catalog.ts";
import { type Installed, packNotes } from "./models-pack-notes.ts";
import { perfStats, variantSpeed } from "./models-perf.ts";
import { evalReports, type Measured, NOT_MEASURED, packQuality, refdocQuality } from "./models-quality.ts";
import { budgets, readRegistry } from "./models-registry.ts";
import {
  DEFAULT_QUERY_TASK,
  type Resolution,
  type ResolveDeps,
  resolveChoice,
  resolveInstalled,
  variantName,
} from "./models-resolve.ts";

export type PackModel = { id: string; label: string; kind: "embedding" | "reranker"; installed: boolean };

export type PackRow = {
  id: string;
  label: string;
  intent: string;
  active: boolean;
  chosen: boolean;
  available: boolean;
  variant: number | null;
  embedding: string | null;
  reranker: string | null;
  models: PackModel[];
  device: "gpu" | "cpu" | null;
  installed: Installed;
  fit: Fit | null;
  notes: string[];
  downloadMB: number;
  speed?: string;
  quality: string;
  measuredHere: boolean;
  projectQuality?: string;
  processorOnly: boolean;
};

/** what the open project uses on this PC: this PC's choice, what search runs with now (and its pack), the reference */
export type PackContext = {
  chosen: ActiveChoice | null;
  using: { pack: string | null; variant: PackVariant } | null;
  reference: RagChoice | null;
};

export type UsePlan = {
  download: { model: string; sizeMB: number }[];
  dir: string | null;
  reindex: boolean;
  expected: string;
};

function entriesOf(v: PackVariant): CatalogEntry[] {
  return [v.embedding, v.reranker]
    .filter((m): m is string => !!m)
    .map((m) => catalogEntry(m))
    .filter((e): e is CatalogEntry => !!e);
}

// ponytail: a pack made for a GPU that runs here on the processor is several times slower than it promises (Qwen3 0.6B
// indexes 2.1 passages/s on the processor, 27/s on DirectML): it says so and is never the suggestion
export function processorFallback(p: Pack, i: number, machine: MachineProfile): boolean {
  const onCpu = entriesOf(p.variants[i]).every((e) => deviceFor(e, machine) === "cpu");
  return onCpu && p.variants.slice(0, i + 1).some((v) => entriesOf(v).some((e) => e.devices.includes("gpu")));
}

function installedOf(models: PackModel[]): Installed {
  const n = models.filter((m) => m.installed).length;
  return n === models.length ? "all" : n ? "some" : "none";
}

function usedInstead(ctx: PackContext | null, id: string): string | null {
  const u = ctx?.using;
  if (!u || u.pack === id) return null;
  if (u.pack) return `the ${catalog().packs.find((p) => p.id === u.pack)?.label ?? u.pack} pack`;
  return entriesOf(u.variant)
    .map((e) => e.label)
    .join(" + ");
}

const samePack = (c: RagChoice | null | undefined, id: string) => !!c && "pack" in c && c.pack === id;

// Every pack as it is on this PC, worked out here and nowhere else: the variant in use (when the project uses the
// pack) or the one it resolves to, each model installed or not, why the variants before it were left aside, the fit,
// what is left to download, and the notes that say it in words (models-pack-notes.ts)
export async function packRows(
  ctx: PackContext | null,
  queryTask = DEFAULT_QUERY_TASK,
  deps: ResolveDeps = {},
  project?: string,
  reports: Measured[] = project ? evalReports(project) : [],
  refReports: Measured[] = evalReports(refdocDir()),
): Promise<PackRow[]> {
  const stats = perfStats({ last: 50, lines: deps.lines });
  const machine = await (deps.machine ?? (() => machineProfile()))().catch(() => null);
  const rows: PackRow[] = [];
  for (const p of catalog().packs) {
    const r = await resolveChoice({ pack: p.id }, queryTask, deps);
    const using = ctx?.using?.pack === p.id ? ctx.using.variant : null;
    const inUse = using
      ? p.variants.findIndex((v) => v.embedding === using.embedding && v.reranker === using.reranker)
      : -1;
    const index = inUse >= 0 ? inUse : r.variantIndex;
    const v = index === null ? null : p.variants[index];
    const models: PackModel[] = v
      ? entriesOf(v).map((e) => ({
          id: e.id,
          label: e.label,
          kind: e.kind as PackModel["kind"],
          installed: !!resolveInstalled(e.id, queryTask),
        }))
      : [];
    const fit =
      inUse >= 0 && v && machine
        ? fitOf(entriesOf(v), releaseOurs(machine), { headroom: budgets().headroom, lines: deps.lines })
        : (r.fit ?? null);
    const installed = installedOf(models);
    const downloadMB = models
      .filter((m) => !m.installed)
      .reduce((a, m) => a + (catalogEntry(m.id)?.size.downloadMB ?? 0), 0);
    const processorOnly = !!machine && index !== null && processorFallback(p, index, machine);
    const active = inUse >= 0;
    const chosen = samePack(ctx?.chosen, p.id);
    const speed = v ? variantSpeed(v.embedding, v.reranker, stats) : undefined;
    const ref = v
      ? refdocQuality(v, refReports, publishedMeasure(p.id, v.embedding, v.reranker))
      : { text: NOT_MEASURED, here: false };
    const own = v ? packQuality(v, reports) : NOT_MEASURED;
    const notes = packNotes(
      {
        variants: p.variants.length,
        available: !!v,
        shown: index,
        resolved: r.variantIndex,
        picked: r.picked,
        aside: r.aside,
        names: p.variants.map(variantName),
        active,
        chosen,
        installed,
        downloadMB,
        fit,
        processorOnly,
        usedInstead: usedInstead(ctx, p.id),
        reference: samePack(ctx?.reference, p.id),
      },
      machine,
    );
    rows.push({
      id: p.id,
      label: p.label,
      intent: p.intent,
      active,
      chosen,
      available: !!v,
      variant: index,
      embedding: v?.embedding ?? null,
      reranker: v?.reranker ?? null,
      models,
      device: v ? (fit?.device ?? null) : null,
      installed,
      fit,
      notes,
      downloadMB,
      ...(speed ? { speed } : {}),
      quality: ref.text,
      measuredHere: ref.here,
      ...(own !== NOT_MEASURED ? { projectQuality: own } : {}),
      processorOnly,
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
  const free = releaseOurs(machine);
  const packs = catalog().packs;
  for (const id of PACK_ORDER) {
    const p = packs.find((x) => x.id === id);
    if (!p) continue;
    for (const [i, v] of p.variants.entries()) {
      const entries = entriesOf(v);
      // ponytail: a reranker on the processor makes each query take seconds, and llama.cpp on an integrated GPU has the
      // memory but a fraction of a discrete card's compute; both stay a choice, never the suggestion
      const slow = entries.some(
        (e) =>
          ((!e.runtimes.includes("transformers") || e.kind === "reranker") && deviceFor(e, machine) === "cpu") ||
          (isGguf(e) && onIntegratedGpu(e, machine)),
      );
      if (!slow && !processorFallback(p, i, machine) && fitsAlone(entries, free, lines)) return p.id;
    }
  }
  return "light";
}
