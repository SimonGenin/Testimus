import { type Ctx, UserError } from "../command.ts";
import type { ActiveChoice, CatalogEntry, Fit, MachineProfile, PackVariant, RagChoice } from "../types.ts";
import { acceptable, rememberFit } from "./doctor-models.ts";
import { fitOf } from "./fit/verdict.ts";
import { machineProfile } from "./machine/profile.ts";
import { advise, PACK_ORDER } from "./models-advice.ts";
import { catalog, catalogEntry } from "./models-catalog.ts";
import { NO_DIR, NO_DIR_CODE, needEntry, verify } from "./models-install.ts";
import { pull } from "./models-install-pull.ts";
import { type PackRow, planOf, type UsePlan } from "./models-packs.ts";
import { readPerf } from "./models-perf.ts";
import { budgets, readRegistry, runtimesDir, updateRegistry } from "./models-registry.ts";
import { resolveChoice } from "./models-resolve.ts";
import { readProject, readSettings, writeProject } from "./project.ts";

const MB = 1024 * 1024;

// ponytail: the seam the models commands share with their tests and with --mock — activation lives in rag/ (a dynamic
// import keeps rag/ off the models modules' load), the index job is started through the registry (a dynamic import, the
// registry imports these commands), and the mock swaps llama.cpp's download for fake bytes; env has no such seam
export const modelsDeps = {
  activeModels: async (project: string) => (await import("../rag/activation.ts")).activeModels(project),
  activeChoice: async (project: string) => (await import("../rag/activation.ts")).activeChoice(project),
  setActiveChoice: async (project: string, c: ActiveChoice | RagChoice) =>
    (await import("../rag/activation.ts")).setActiveChoice(project, c),
  queryTask: async (project: string) => (await import("../rag/activation.ts")).queryTaskOf(project),
  startIndex: async (project: string): Promise<string> => {
    const { invoke } = await import("../commands/index.ts");
    return ((await invoke("rag.index", {}, { project, wait: false })) as { jobId: string }).jobId;
  },
  llama: () => import("../rag/runtimes/llamacpp.ts"),
};

export function entriesOf(ids: (string | null | undefined)[]): CatalogEntry[] {
  return ids.filter((m): m is string => !!m).map((m) => needEntry(m));
}

function plainChoice(c: ActiveChoice | RagChoice): RagChoice {
  return "pack" in c ? { pack: c.pack } : { embedding: c.embedding, reranker: c.reranker };
}

export async function currentVariant(project: string): Promise<{ choice: RagChoice; variant: PackVariant } | null> {
  const a = await modelsDeps.activeModels(project);
  if (!a.embedding || !a.choice) return null;
  return {
    choice: plainChoice(a.choice),
    variant: { embedding: a.embedding.entry.id, reranker: a.reranker?.entry.id ?? null },
  };
}

export async function adviceList(project: string) {
  const cur = await currentVariant(project);
  if (!cur) return [];
  return advise({
    choice: cur.choice,
    variant: cur.variant,
    machine: await machineProfile(),
    lines: readPerf(),
    budgets: budgets(),
    dismissed: readSettings().rag?.dismissed ?? {},
    project,
  });
}

export function setReference(project: string, c: RagChoice): void {
  const p = readProject(project);
  writeProject(project, { ...p, rag: { ...p.rag, reference: c } });
}

export async function pullLlama(ctx: Ctx, backend: "auto" | "cuda" | "vulkan" | "cpu") {
  const dir = runtimesDir();
  if (!dir)
    throw new UserError(NO_DIR, "Or set the runtimes folder: testimus models setDir <folder> --runtimes.", NO_DIR_CODE);
  const llama = await modelsDeps.llama();
  const chosen = backend === "auto" ? llama.chooseBackend(await machineProfile()) : backend;
  const build = await llama.pullLlamaBuild(
    chosen,
    dir,
    (p) =>
      ctx.progress({
        message: `llama.cpp ${p.file}`,
        done: Math.round(p.loaded / MB),
        total: Math.round(p.total / MB),
      }),
    ctx.signal,
  );
  updateRegistry((r) => {
    r.llamacpp = { ...build, via: "download" };
  });
  return build;
}

async function llamaMB(): Promise<number> {
  const llama = await modelsDeps.llama();
  const assets = llama.LLAMA_ASSETS[llama.chooseBackend(await machineProfile())];
  return assets.reduce((a, x) => a + x.size, 0) / MB;
}

function stage(ctx: Ctx, from: number, size: number, total: number): Ctx {
  return {
    ...ctx,
    progress: (p) =>
      ctx.progress({
        message: p.message,
        done: Math.round(from + (p.total ? (size * Math.min(p.done ?? 0, p.total)) / p.total : 0)),
        total: Math.round(total),
      }),
  };
}

function needsLlama(models: string[]): boolean {
  return models.some((id) => {
    const e = catalogEntry(id);
    return !!e && !e.runtimes.includes("transformers") && e.runtimes.includes("llamacpp");
  });
}

// ponytail: « a lighter one » for the fit dialog — the heaviest catalog model of the same kind, smaller to download,
// that fits this PC
export function lighterModel(entry: CatalogEntry, machine: MachineProfile): string | null {
  const headroom = budgets().headroom;
  const lines = readPerf();
  return (
    catalog()
      .entries.filter((c) => c.kind === entry.kind && c.id !== entry.id && c.size.downloadMB < entry.size.downloadMB)
      .filter((c) => fitOf([c], machine, { headroom, lines }).verdict === "fits")
      .sort((a, b) => b.size.downloadMB - a.size.downloadMB)[0]?.id ?? null
  );
}

// ponytail: the next lighter pack that fits as it is meant to run (a 4 GB card: Performance on DirectML rather than
// Balanced on the processor), else the next one available at all
export function lighterPack(
  rows: Pick<PackRow, "id" | "available" | "fit" | "processorOnly">[],
  id: string,
): string | null {
  const below = PACK_ORDER.slice(PACK_ORDER.indexOf(id) + 1).flatMap((p) => {
    const row = rows.find((x) => x.id === p && x.available);
    return row ? [row] : [];
  });
  return (below.find((r) => r.fit?.verdict === "fits" && !r.processorOnly) ?? below[0])?.id ?? null;
}

export type UseInput = {
  embedding?: string;
  reranker?: string | null;
  reference: boolean;
  dryRun: boolean;
  accept?: boolean;
};
export type UseResult = {
  choice: { embedding: string; reranker: string | null };
  fit: Fit;
  reindex: boolean;
  indexJob: string | null;
  lighter: string | null;
  dryRun: boolean;
};

export async function useModels(project: string, input: UseInput): Promise<UseResult> {
  const cur = await currentVariant(project).catch(() => null);
  const embedding = input.embedding ?? cur?.variant.embedding;
  if (!embedding) throw new UserError("Name the embedding to use.", "testimus models use --embedding <id>");
  const reranker = input.reranker === undefined ? (cur?.variant.reranker ?? null) : input.reranker;
  const entries = entriesOf([embedding, reranker]);
  if (entries[0].kind !== "embedding")
    throw new UserError(
      `${embedding} is not an embedding model.`,
      "testimus models catalog --kind embedding lists them.",
    );
  if (reranker && entries[1]?.kind !== "reranker")
    throw new UserError(`${reranker} is not a reranker.`, "testimus models catalog --kind reranker lists them.");
  const machine = await machineProfile();
  const fit = fitOf(entries, machine, { headroom: budgets().headroom, lines: readPerf() });
  const named = input.embedding || !reranker ? entries[0] : entries[1];
  const choice = { embedding, reranker };
  const reindex = cur?.variant.embedding !== embedding;
  const out = { choice, fit, reindex, indexJob: null, lighter: lighterModel(named, machine) };
  if (input.dryRun) return { ...out, dryRun: true };
  if (fit.verdict === "ram-too-small") throw new UserError(fit.message, "Choose a lighter model.");
  if (fit.verdict === "unsupported") throw new UserError(fit.message, "Choose a model this system runs.");
  const r = await resolveChoice(choice, await modelsDeps.queryTask(project));
  if (r.missing.length)
    throw new UserError(
      `Not on this PC yet: ${r.missing.join(", ")}.`,
      `Download first: ${r.missing.map((m) => `testimus models pull ${m}`).join(" ; ")}`,
    );
  await modelsDeps.setActiveChoice(project, choice);
  if (input.accept && acceptable(fit.verdict)) rememberFit(entries, fit.verdict);
  if (input.reference) setReference(project, choice);
  const indexJob = reindex ? await modelsDeps.startIndex(project) : null;
  return { ...out, indexJob, dryRun: false };
}

export type PackPlan = {
  pack: string;
  variant: number;
  embedding: string;
  reranker: string | null;
  plan: UsePlan;
};

export async function planPack(project: string, id: string): Promise<PackPlan & { llama: boolean }> {
  const r = await resolveChoice({ pack: id }, await modelsDeps.queryTask(project));
  if (!r.variant || r.variantIndex === null)
    throw new UserError(
      `The ${id} pack is not available on this PC: ${r.skipped.join("; ") || "unknown pack"}.`,
      "testimus models packs shows each pack and why.",
    );
  const models = [r.variant.embedding, r.variant.reranker].filter((m): m is string => !!m);
  return {
    pack: id,
    variant: r.variantIndex,
    embedding: r.variant.embedding,
    reranker: r.variant.reranker,
    plan: planOf(r, await modelsDeps.activeChoice(project)),
    llama: needsLlama(models) && !readRegistry().llamacpp,
  };
}

export type PackInput = { pack: string; reference: boolean; downloadOnly: boolean; accept?: boolean };

// ponytail: one job with its steps — download what the variant needs (and llama.cpp), try each download, activate,
// start the index (a child job, carried by the activate step)
export async function usePack(
  ctx: Ctx,
  project: string,
  input: PackInput,
): Promise<PackPlan & { indexJob: string | null }> {
  const { llama, ...p } = await planPack(project, input.pack);
  // ponytail: « Use anyway » accepts the verdict the user saw, judged before the downloads change anything
  const entries = entriesOf([p.embedding, p.reranker]);
  const seen = input.accept
    ? fitOf(entries, await machineProfile(), { headroom: budgets().headroom, lines: readPerf() }).verdict
    : null;
  const downloads = p.plan.download;
  if ((downloads.length || llama) && !p.plan.dir)
    throw new UserError(NO_DIR, "Then choose the pack again.", NO_DIR_CODE);
  ctx.steps?.([
    ...(downloads.length ? [{ id: "download", label: "Download the models" }] : []),
    ...(llama ? [{ id: "runtime", label: "Download llama.cpp" }] : []),
    ...(downloads.length ? [{ id: "verify", label: "Try each downloaded model" }] : []),
    ...(input.downloadOnly ? [] : [{ id: "activate", label: "Use the pack and index the documents" }]),
  ]);
  const sizes = downloads.map((d) => d.sizeMB);
  if (llama) sizes.push(await llamaMB());
  const total = sizes.reduce((a, s) => a + s, 0);
  let from = 0;
  if (downloads.length) ctx.step?.("download");
  for (const [i, d] of downloads.entries()) {
    const got = await pull(stage(ctx, from, sizes[i], total), { model: d.model });
    from += sizes[i];
    ctx.progress({
      message: `${catalogEntry(got.model)?.label ?? got.model}: ready`,
      done: Math.round(from),
      total: Math.round(total),
    });
  }
  if (llama) {
    ctx.step?.("runtime");
    await pullLlama(stage(ctx, from, sizes.at(-1) ?? 0, total), "auto");
  }
  if (downloads.length) ctx.step?.("verify");
  for (const d of downloads) {
    ctx.progress({ message: `Trying ${catalogEntry(d.model)?.label ?? d.model}` });
    const tried = await verify(d.model);
    if (!tried.ok)
      throw new UserError(
        `${catalogEntry(d.model)?.label ?? d.model} is downloaded but does not run on this PC: ${tried.message}`,
        "The project keeps its current pack; choose another one in Settings › Models.",
      );
  }
  if (input.downloadOnly) return { ...p, indexJob: null };
  ctx.step?.("activate");
  const variant = { embedding: p.embedding, reranker: p.reranker };
  await modelsDeps.setActiveChoice(project, { pack: input.pack, variant });
  if (seen && acceptable(seen)) rememberFit(entries, seen);
  if (input.reference) setReference(project, { pack: input.pack });
  return { ...p, indexJob: p.plan.reindex ? await modelsDeps.startIndex(project) : null };
}
