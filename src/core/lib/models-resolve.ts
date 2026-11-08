import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CatalogEntry,
  Device,
  Fit,
  Installation,
  MachineProfile,
  PackVariant,
  PerfLine,
  RagChoice,
  ResolvedModel,
  RuntimeId,
} from "../types.ts";
import { deviceFor, deviceOf, isGguf } from "./fit/placement.ts";
import { unsupportedOn } from "./fit/support.ts";
import { fitOf, gb, releaseOurs } from "./fit/verdict.ts";
import { knownMachine, machineProfile, platformOf, systemName } from "./machine/profile.ts";
import { catalogEntry, entriesOf, pack } from "./models-catalog.ts";
import { filesFor, filesPresent } from "./models-download.ts";
import { budgets, downloadsAllowed, modelsDir, readRegistry } from "./models-registry.ts";
import { isComplete, modelDir, modelRoots } from "./models-store.ts";

export const DEFAULT_QUERY_TASK =
  "Given a question about a railway simulator specification, retrieve the passages that answer it";

export type ModelSource = "registered" | "found" | "download" | "unavailable";
/** a variant of a pack left aside on this PC, with the one reason */
export type Aside = { variant: number; models: string; reason: string };
/** how the variant was picked: the first that fits, one already here that fits without the margin, or none fits
 * comfortably and this one runs */
export type Picked = "first-fit" | "kept" | "fallback";
export type Resolution = {
  choice: RagChoice;
  variant: PackVariant | null;
  variantIndex: number | null;
  embedding: ResolvedModel | null;
  reranker: ResolvedModel | null;
  aside: Aside[];
  picked: Picked | null;
  missing: string[];
  fit?: Fit | null;
  sources?: Record<string, ModelSource>;
  reasons?: Record<string, string>;
};
export type ResolveDeps = {
  machine?: () => Promise<MachineProfile>;
  lines?: PerfLine[];
};

function dtypeOf(entry: CatalogEntry, device: Device) {
  return entry.dtypeByDevice?.[device] ?? entry.dtypeByDevice?.cpu;
}

function resolved(entry: CatalogEntry, install: Installation, queryTask: string): ResolvedModel {
  const machine = knownMachine();
  const device =
    install.runtime === "transformers"
      ? (install.device ?? deviceOf(entry, machine))
      : machine
        ? deviceOf(entry, machine)
        : (install.device ?? "cpu");
  const dtype = install.dtype ?? dtypeOf(entry, device);
  return {
    entry,
    install: { ...install, device, ...(dtype ? { dtype } : {}) },
    runtime: install.runtime,
    device,
    ...(dtype ? { dtype } : {}),
    queryTask,
  };
}

export function ggufPath(root: string, entry: CatalogEntry): string | null {
  const hf = entry.source.hf;
  return hf?.path ? join(modelDir(root, hf.repo), ...hf.path.split("/")) : null;
}

function foundOnDisk(entry: CatalogEntry): Installation | null {
  const hf = entry.source.hf;
  if (!hf) return null;
  const dir = modelsDir();
  const roots = [...(dir ? [dir] : []), ...modelRoots().map((r) => r.dir)];
  if (isGguf(entry)) {
    if (!entry.runtimes.includes("llamacpp")) return null;
    for (const root of roots) {
      const file = ggufPath(root, entry);
      if (file && existsSync(file))
        return {
          model: entry.id,
          via: "path",
          runtime: "llamacpp",
          path: file,
          revision: hf.revision,
          status: "installed",
        };
    }
    return null;
  }
  const device = deviceOf(entry, knownMachine());
  const dtype = dtypeOf(entry, device);
  const files = filesFor(entry, dtype);
  const dirs = roots.map((r) => modelDir(r, hf.repo));
  const pinned = dirs.find((d) => filesPresent(d, files));
  const path = pinned ?? dirs.find((d) => isComplete(d, dtype));
  if (!path) return null;
  return {
    model: entry.id,
    via: "path",
    runtime: "transformers",
    path,
    ...(pinned ? { revision: hf.revision } : {}),
    ...(dtype ? { dtype } : {}),
    device,
    status: "installed",
  };
}

function registered(entry: CatalogEntry): Installation | null {
  const mine = readRegistry().installs.filter((i) => i.model === entry.id && i.status !== "broken");
  return mine.find((i) => i.path && existsSync(i.path)) ?? null;
}

export function resolveInstalled(id: string, queryTask = DEFAULT_QUERY_TASK): ResolvedModel | null {
  const entry = catalogEntry(id);
  if (!entry) return null;
  const local = registered(entry) ?? foundOnDisk(entry);
  return local ? resolved(entry, local, queryTask) : null;
}

export function downloadRuntime(entry: CatalogEntry): RuntimeId | null {
  if (entry.runtimes.includes("transformers")) return "transformers";
  if (entry.runtimes.includes("llamacpp")) return "llamacpp";
  return null;
}

type One = { model: ResolvedModel | null; source: ModelSource; reason: string };

function resolveOne(id: string, queryTask: string): One {
  const entry = catalogEntry(id);
  if (!entry) return { model: null, source: "unavailable", reason: `${id} is not in the catalog` };
  const reg = registered(entry);
  if (reg) return { model: resolved(entry, reg, queryTask), source: "registered", reason: "" };
  const found = foundOnDisk(entry);
  if (found) return { model: resolved(entry, found, queryTask), source: "found", reason: "" };
  const runtime = downloadRuntime(entry);
  if (!entry.source.hf || !runtime)
    return { model: null, source: "unavailable", reason: `${entry.label} has no download source` };
  if (!downloadsAllowed())
    return {
      model: null,
      source: "unavailable",
      reason: `${entry.label} is not on this PC and downloads are off (allowRemote = false)`,
    };
  return { model: null, source: "download", reason: "" };
}

type Tried = { v: PackVariant; i: number; one: Record<string, One>; fit: Fit | null; ok: boolean; slow: boolean };

// The one reason a variant is left aside on this PC, as a clause: no runtime here, cannot be downloaded, the memory it needs
// against what this PC has (with the numbers), never run on this system, or llama.cpp on the processor; "" = none
function asideReason(t: Tried, machine: MachineProfile | null, headroom: number): string {
  const entries = entriesOf([t.v.embedding, t.v.reranker]);
  const off = machine ? [...new Set(entries.map((e) => unsupportedOn(e, machine)).filter((w) => !!w))] : [];
  if (off.length) return `no runtime here: ${off.join("; ")}`;
  const gone = Object.values(t.one).find((o) => o.source === "unavailable");
  if (gone) return gone.reason;
  const f = t.fit;
  if (!f || f.verdict === "fits")
    return t.slow ? "llama.cpp would run on the processor here, several times slower" : "";
  const keep = 1 - headroom;
  if (f.verdict === "gpu-too-small")
    return `needs ${gb(f.needMB.vram)} of GPU memory, this PC has ${gb(f.totalMB.vram ?? 0)}`;
  if (f.verdict === "ram-too-small") return `needs ${gb(f.needMB.ram)} of memory, this PC has ${gb(f.totalMB.ram)}`;
  if (f.verdict === "unknown") return "the free memory of the GPU cannot be read";
  if (f.verdict === "untested")
    return `never run on ${systemName(platformOf(machine as MachineProfile))} ${machine?.system?.arch ?? "x64"} yet`;
  const gpuShort = f.device === "gpu" && f.freeMB.vram !== null && f.needMB.vram > f.freeMB.vram * keep;
  return gpuShort
    ? `needs ${gb(f.needMB.vram)} of GPU memory, ${gb((f.freeMB.vram ?? 0) * keep)} usable now`
    : `needs ${gb(f.needMB.ram)} of memory, ${gb(f.freeMB.ram * keep)} usable now`;
}

/** this PC can run the variant at all: a runtime for it and the memory to load it (a tight fit runs) */
export function runsHere(v: PackVariant, machine: MachineProfile | null): boolean {
  if (!machine) return true;
  const verdict = fitOf(entriesOf([v.embedding, v.reranker]), releaseOurs(machine), {
    headroom: budgets().headroom,
  }).verdict;
  return verdict !== "unsupported" && verdict !== "ram-too-small";
}

export const variantName = (v: PackVariant): string =>
  entriesOf([v.embedding, v.reranker])
    .map((e) => e.label)
    .join(" + ");

export async function resolveChoice(
  choice: RagChoice,
  queryTask = DEFAULT_QUERY_TASK,
  deps: ResolveDeps = {},
): Promise<Resolution> {
  const isPack = "pack" in choice;
  const p = isPack ? pack(choice.pack) : undefined;
  const variants: PackVariant[] = isPack
    ? (p?.variants ?? [])
    : [{ embedding: choice.embedding, reranker: choice.reranker }];
  const read = isPack || deps.machine ? await (deps.machine ?? (() => machineProfile()))() : knownMachine();
  // ponytail: the models Testimus itself holds are let go when another choice is used — a variant is judged on the
  // memory they would give back, so a model in use never makes another variant « too big »
  const machine = read ? releaseOurs(read) : null;
  const headroom = budgets().headroom;
  const tried: Tried[] = [];
  for (const [i, v] of variants.entries()) {
    const one: Record<string, One> = {};
    for (const id of [v.embedding, v.reranker].filter((m): m is string => !!m)) one[id] = resolveOne(id, queryTask);
    const fit = machine ? fitOf(entriesOf([v.embedding, v.reranker]), machine, { headroom, lines: deps.lines }) : null;
    const ok = fit?.verdict !== "unsupported" && !Object.values(one).some((o) => o.source === "unavailable");
    // ponytail: llama.cpp on the processor indexes several times slower; a later variant without it is preferred
    const slow =
      isPack &&
      !!machine &&
      entriesOf([v.embedding, v.reranker]).some((e) => isGguf(e) && deviceFor(e, machine) === "cpu");
    tried.push({ v, i, one, fit, ok, slow });
    if (ok && !slow && (!fit || fit.verdict === "fits")) break;
  }
  const fits = (t: Tried) => t.ok && (!t.fit || t.fit.verdict === "fits");
  const fitting = tried.find((t) => fits(t) && !t.slow) ?? tried.find(fits);
  const fallback = [...tried].reverse().find((t) => t.ok && t.fit?.verdict !== "ram-too-small");
  // ponytail: a variant already on this PC that fits the free memory without the margin beats a later one to
  // download, so the pack does not change with what other programs hold at the moment it is chosen
  const onPc = (t: Tried) => Object.values(t.one).every((o) => o.source !== "download");
  const kept =
    isPack && fitting && !onPc(fitting)
      ? tried.find((t) => t.i < fitting.i && t.ok && t.fit && withoutMargin(t.fit) && onPc(t))
      : undefined;
  const pick = kept ?? fitting ?? (isPack ? fallback : tried[0]);
  const asideOf = (t: Tried): Aside => ({
    variant: t.i,
    models: variantName(t.v),
    reason: asideReason(t, machine, headroom) || "a variant above was preferred",
  });
  if (!pick)
    return {
      choice,
      variant: null,
      variantIndex: null,
      embedding: null,
      reranker: null,
      aside: tried.map(asideOf),
      picked: null,
      missing: [],
      fit: tried.at(-1)?.fit ?? null,
      sources: {},
      reasons: Object.fromEntries(tried.flatMap((t) => Object.entries(t.one).map(([k, o]) => [k, o.reason]))),
    };
  const emb = pick.one[pick.v.embedding];
  const rr = pick.v.reranker ? pick.one[pick.v.reranker] : null;
  return {
    choice,
    variant: pick.v,
    variantIndex: isPack ? pick.i : null,
    embedding: emb?.model ?? null,
    reranker: rr?.model ?? null,
    aside: tried.filter((t) => t.i < pick.i).map(asideOf),
    picked: pick === kept ? "kept" : pick === fitting ? "first-fit" : "fallback",
    missing: Object.entries(pick.one)
      .filter(([, o]) => !o.model)
      .map(([k]) => k),
    fit: pick.fit,
    sources: Object.fromEntries(Object.entries(pick.one).map(([k, o]) => [k, o.source])),
    reasons: Object.fromEntries(
      Object.entries(pick.one)
        .filter(([, o]) => o.reason)
        .map(([k, o]) => [k, o.reason]),
    ),
  };
}

function withoutMargin(fit: Fit): boolean {
  if (fit.verdict !== "tight" || fit.needMB.ram > fit.freeMB.ram) return false;
  return fit.device === "cpu" || (fit.freeMB.vram !== null && fit.needMB.vram <= fit.freeMB.vram);
}
