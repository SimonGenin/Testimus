import { z } from "zod";
import { type Command, type Ctx, command, projectOf, UserError } from "../command.ts";
import { startJob } from "../jobs.ts";
import { advise } from "../lib/models-advice.ts";
import { catalogEntry } from "../lib/models-catalog.ts";
import { applySetDir, planSetDir } from "../lib/models-dir.ts";
import { fitOf } from "../lib/models-fit.ts";
import { machineProfile } from "../lib/models-hardware.ts";
import { addPath, catalogView, list, NO_DIR, needEntry, pull, remove, verify } from "../lib/models-install.ts";
import { packRows, planOf, suggestPack } from "../lib/models-packs.ts";
import { perfStats, readPerf, withPerfScope } from "../lib/models-perf.ts";
import { budgets, readRegistry, runtimesDir, updateRegistry } from "../lib/models-registry.ts";
import { resolveChoice } from "../lib/models-resolve.ts";
import { readProject, readSettings, writeProject, writeSettings } from "../lib/project.ts";
import type { ActiveChoice, CatalogEntry, PackVariant, RagChoice } from "../types.ts";

const MB = 1024 * 1024;

const fitVerdict = z.enum(["fits", "tight", "gpu-too-small", "ram-too-small", "unknown"]);
const fit = z.object({
  verdict: fitVerdict,
  device: z.enum(["gpu", "cpu"]),
  needMB: z.object({ vram: z.number(), ram: z.number() }),
  freeMB: z.object({ vram: z.number().nullable(), ram: z.number() }),
  totalMB: z.object({ vram: z.number().nullable(), ram: z.number() }),
  unload: z.array(z.string()).describe("Loaded models to unload for a « tight » fit"),
  message: z.string().describe("The verdict in words, with the numbers"),
});
const state = z.enum(["available", "downloading", "installed", "verified", "active", "broken", "outdated"]);
const choice = z.union([
  z.object({ pack: z.string() }),
  z.object({ embedding: z.string(), reranker: z.string().nullable() }),
]);
const plan = z.object({
  download: z.array(z.object({ model: z.string(), sizeMB: z.number() })).describe("Catalog models to download first"),
  dir: z.string().nullable().describe("Where downloads go (null = the storage folder is not chosen yet)"),
  reindex: z.boolean().describe("A new vector space will be built"),
  expected: z.string().describe("Expected speed on this PC when the journal knows it"),
});

export const modelsDeps = {
  activeModels: async (project: string) => (await import("../rag/activation.ts")).activeModels(project),
  activeChoice: async (project: string) => (await import("../rag/activation.ts")).activeChoice(project),
  setActiveChoice: async (project: string, c: ActiveChoice | RagChoice) =>
    (await import("../rag/activation.ts")).setActiveChoice(project, c),
  queryTask: async (project: string) => (await import("../rag/activation.ts")).queryTaskOf(project),
  startIndex: async (project: string): Promise<string> => {
    const { invoke } = await import("./index.ts");
    return ((await invoke("rag.index", {}, { project, wait: false })) as { jobId: string }).jobId;
  },
  llama: () => import("../rag/runtimes/llamacpp.ts"),
};

function entriesOf(ids: (string | null | undefined)[]): CatalogEntry[] {
  return ids.filter((m): m is string => !!m).map((m) => needEntry(m));
}

function plainChoice(c: ActiveChoice | RagChoice): RagChoice {
  return "pack" in c ? { pack: c.pack } : { embedding: c.embedding, reranker: c.reranker };
}

async function currentVariant(project: string): Promise<{ choice: RagChoice; variant: PackVariant } | null> {
  const a = await modelsDeps.activeModels(project);
  if (!a.embedding || !a.choice) return null;
  return {
    choice: plainChoice(a.choice),
    variant: { embedding: a.embedding.entry.id, reranker: a.reranker?.entry.id ?? null },
  };
}

async function adviceList(project: string) {
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

function setReference(project: string, c: RagChoice): void {
  const p = readProject(project);
  writeProject(project, { ...p, rag: { ...p.rag, reference: c } });
}

async function pullLlama(ctx: Ctx, backend: "auto" | "cuda" | "vulkan" | "cpu") {
  const dir = runtimesDir();
  if (!dir) throw new UserError(NO_DIR, "Or set the runtimes folder: testimus models setDir <folder> --runtimes.");
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

function needsLlama(models: string[]): boolean {
  return models.some((id) => {
    const e = catalogEntry(id);
    return !!e && !e.runtimes.includes("transformers") && e.runtimes.includes("llamacpp");
  });
}

export const commands: Command[] = [
  command({
    name: "models.catalog",
    summary: "The model catalog, with whether each entry fits this PC (RAM, GPU) and its tier.",
    input: z.object({ kind: z.enum(["embedding", "reranker"]).optional().describe("Only this kind") }),
    output: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["embedding", "reranker"]),
        label: z.string(),
        tier: z.string(),
        runtimes: z.array(z.string()),
        quantization: z.string(),
        dims: z.number(),
        sizeMB: z.number(),
        state,
        fit,
      }),
    ),
    mutates: false,
    global: true,
    run: async (_ctx, input) => catalogView(input.kind),
  }),
  command({
    name: "models.list",
    summary: "Installed models: where, how (path · download), size, state, used by which projects.",
    input: z.object({}),
    output: z.array(
      z.object({
        model: z.string(),
        label: z.string(),
        via: z.enum(["path", "download"]),
        runtime: z.string(),
        where: z.string(),
        sizeMB: z.number(),
        state,
        usedBy: z.array(z.string()),
        perf: z.string().optional().describe("« on this PC: query 40 ms, index 120 passages/s »"),
      }),
    ),
    mutates: false,
    global: true,
    run: async () => list(),
  }),
  command({
    name: "models.add",
    summary:
      "Register a model folder or file already on disk (path A), or a llama.cpp build folder; never copies unless copy.",
    input: z.object({
      path: z.string().describe("Absolute path: a Hugging Face model folder, a .gguf file, or a llama.cpp folder"),
      model: z.string().optional().describe("Catalog id it is (guessed from the files when omitted)"),
      copy: z.boolean().default(false).describe("Copy it into the models folder instead of using it in place"),
    }),
    output: z.object({ model: z.string(), via: z.literal("path"), path: z.string(), dims: z.number(), state }),
    mutates: true,
    global: true,
    positional: ["path"],
    run: async (ctx, input) => withPerfScope({}, () => addPath(input, ctx), ctx.signal),
  }),
  command({
    name: "models.pull",
    summary: "Download a catalog model (SHA-256 checked); a job. Stops if the models folder is not chosen.",
    input: z.object({
      model: z.string().describe("Catalog id"),
      dir: z.string().optional().describe("Models folder for this download (sets it when not chosen yet)"),
      dtype: z.string().optional().describe("transformers models: the dtype to fetch (default from the catalog)"),
    }),
    output: z.object({ model: z.string(), via: z.string(), where: z.string(), sizeMB: z.number(), state }),
    mutates: true,
    global: true,
    job: "models-pull",
    positional: ["model"],
    subject: (i) => i.model,
    run: async (ctx, input) => pull(ctx, input),
  }),
  command({
    name: "models.pullRuntime",
    summary: "Download the llama.cpp build that fits this PC (CUDA → Vulkan → CPU) into the runtimes folder; a job.",
    input: z.object({
      backend: z.enum(["auto", "cuda", "vulkan", "cpu"]).default("auto").describe("auto = from the machine profile"),
    }),
    output: z.object({ exe: z.string(), build: z.string(), backend: z.enum(["cuda", "vulkan", "cpu"]) }),
    mutates: true,
    global: true,
    job: "models-pull",
    subject: () => "llama.cpp",
    async run(ctx, input) {
      const build = await pullLlama(ctx, input.backend);
      return { exe: build.exe, build: build.build, backend: build.backend };
    },
  }),
  command({
    name: "models.remove",
    summary: "Remove a model: a download deletes its files; a path is only unregistered.",
    input: z.object({ model: z.string().describe("Catalog id") }),
    output: z.object({ model: z.string(), removed: z.enum(["files", "registration"]), freedMB: z.number() }),
    mutates: true,
    global: true,
    positional: ["model"],
    run: async (_ctx, input) => remove(input.model),
  }),
  command({
    name: "models.verify",
    summary:
      "Probe a model: load it, embed one sentence, check the dimension and the fingerprint; records verified or broken.",
    input: z.object({ model: z.string().describe("Catalog id") }),
    output: z.object({ model: z.string(), ok: z.boolean(), dims: z.number(), ms: z.number(), message: z.string() }),
    mutates: true,
    global: true,
    positional: ["model"],
    run: async (ctx, input) => withPerfScope({}, () => verify(input.model), ctx.signal),
  }),
  command({
    name: "models.setDir",
    summary:
      "Choose or change the models folder (or the runtimes folder); existing downloads move, stay or are copied.",
    input: z.object({
      dir: z.string().describe("Absolute folder, outside any project folder"),
      runtimes: z.boolean().default(false).describe("Set the llama.cpp runtimes folder instead of the models folder"),
      move: z.boolean().default(false).describe("Move the downloaded models there (default when changing in the UI)"),
      keep: z.boolean().default(false).describe("Leave them where they are; only new downloads go there"),
      copy: z.boolean().default(false).describe("Copy them there and keep the old copy"),
      dryRun: z.boolean().default(false).describe("Show what would happen"),
      wait: z.boolean().default(false).describe("Wait for the move or copy job to end (its progress is printed)"),
    }),
    output: z.object({
      dir: z.string(),
      drive: z.object({ root: z.string(), freeMB: z.number() }),
      installedMB: z.number(),
      action: z.enum(["set", "move", "keep", "copy"]),
      files: z.number(),
      jobId: z.string().optional().describe("The move or copy job"),
      dryRun: z.boolean(),
    }),
    mutates: true,
    global: true,
    positional: ["dir"],
    async run(_ctx, input) {
      const p = planSetDir(input);
      const out = {
        dir: p.dir,
        drive: p.drive,
        installedMB: p.installedMB,
        action: p.action,
        files: p.files,
        dryRun: input.dryRun,
      };
      if (input.dryRun) return out;
      if (p.action === "set" || p.action === "keep") {
        await applySetDir(p, { signal: new AbortController().signal, onProgress: () => {} });
        return out;
      }
      const { job, done } = startJob(`models-${p.action}`, p.dir, null, (ctx) =>
        applySetDir(p, {
          signal: ctx.signal,
          onProgress: (d, total, what) =>
            ctx.progress({
              message: `${p.action === "move" ? "Moving" : "Copying"} ${what}`,
              done: Math.round(d / MB),
              total: Math.round(total / MB),
            }),
        }),
      );
      if (input.wait) {
        const r = (await done) as { cancelled: boolean };
        if (r.cancelled) throw new UserError("Cancelled: the old copy is intact and nothing changed.");
      }
      return { ...out, jobId: job.id };
    },
  }),
  command({
    name: "models.use",
    summary:
      "Use an embedding and/or a reranker for the open project on this PC (the « Custom » pack); reindex follows.",
    input: z.object({
      embedding: z.string().optional().describe("Catalog id of the embedding"),
      reranker: z.string().nullable().optional().describe("Catalog id of the reranker, or null for none"),
      reference: z.boolean().default(false).describe("Also make it the team reference in project.json"),
    }),
    output: z.object({ choice, fit, reindex: z.boolean() }),
    mutates: true,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const cur = await currentVariant(project).catch(() => null);
      const embedding = input.embedding ?? cur?.variant.embedding;
      if (!embedding) throw new UserError("Name the embedding to use.", "testimus models use --embedding <id>");
      const reranker = input.reranker === undefined ? (cur?.variant.reranker ?? null) : input.reranker;
      const entries = entriesOf([embedding, reranker]);
      if (entries[0].kind !== "embedding") throw new UserError(`${embedding} is not an embedding model.`);
      if (reranker && entries[1]?.kind !== "reranker") throw new UserError(`${reranker} is not a reranker.`);
      const f = fitOf(entries, await machineProfile(), { headroom: budgets().headroom, lines: readPerf() });
      if (f.verdict === "ram-too-small") throw new UserError(f.message, "Choose a lighter model.");
      const r = await resolveChoice({ embedding, reranker }, await modelsDeps.queryTask(project));
      if (r.missing.length)
        throw new UserError(
          `Not on this PC yet: ${r.missing.join(", ")}.`,
          `Download first: ${r.missing.map((m) => `testimus models pull ${m}`).join(" ; ")}`,
        );
      const c = { embedding, reranker };
      const reindex = cur?.variant.embedding !== embedding;
      await modelsDeps.setActiveChoice(project, c);
      if (input.reference) setReference(project, c);
      if (reindex) await modelsDeps.startIndex(project);
      return { choice: c, fit: f, reindex };
    },
  }),
  command({
    name: "models.packs",
    summary:
      "The packs, each with the variant it resolves to on this PC, its fit, what is left to download, speed and quality.",
    input: z.object({}),
    output: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        intent: z.string(),
        active: z.boolean(),
        available: z.boolean(),
        variant: z.number().nullable().describe("Index of the variant that applies here (null = none fits)"),
        embedding: z.string().nullable(),
        reranker: z.string().nullable(),
        fit: fit.nullable(),
        skipped: z.array(z.string()).describe("Why the variants above were skipped, with the numbers"),
        downloadMB: z.number(),
        speed: z.string().optional(),
        quality: z.string().describe("Measured evidence recall, or « quality not measured yet »"),
        suggested: z
          .boolean()
          .describe(
            "The pack proposed at first launch: the heaviest that fits without a GGUF on the processor, else Light",
          ),
      }),
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
      return rows.map((r) => ({ ...r, suggested: r.id === suggested }));
    },
  }),
  command({
    name: "models.usePack",
    summary:
      "Use a pack for the open project on this PC: install what its variant needs, activate it, start the index job.",
    input: z.object({
      pack: z.string().describe("light, performance, balanced, quality"),
      reference: z.boolean().default(false).describe("Also make it the team reference in project.json"),
      dryRun: z.boolean().default(false).describe("Show the plan: downloads, where, reindex, expected speed"),
    }),
    output: z.object({
      pack: z.string(),
      variant: z.number(),
      embedding: z.string(),
      reranker: z.string().nullable(),
      plan,
      jobIds: z.array(z.string()).describe("Download and index jobs started"),
      dryRun: z.boolean(),
    }),
    mutates: true,
    positional: ["pack"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const r = await resolveChoice({ pack: input.pack }, await modelsDeps.queryTask(project));
      if (!r.variant || r.variantIndex === null)
        throw new UserError(
          `The ${input.pack} pack is not available on this PC: ${r.skipped.join("; ") || "unknown pack"}.`,
          "testimus models packs shows each pack and why.",
        );
      const variant = r.variant;
      const p = planOf(r, await modelsDeps.activeChoice(project));
      const out = {
        pack: input.pack,
        variant: r.variantIndex,
        embedding: variant.embedding,
        reranker: variant.reranker,
        plan: p,
      };
      if (input.dryRun) return { ...out, jobIds: [], dryRun: true };
      const models = [variant.embedding, variant.reranker].filter((m): m is string => !!m);
      const llama = needsLlama(models) && !readRegistry().llamacpp;
      if ((p.download.length || llama) && !p.dir) throw new UserError(NO_DIR, "Then choose the pack again.");
      const activate = async () => {
        await modelsDeps.setActiveChoice(project, { pack: input.pack, variant });
        if (input.reference) setReference(project, { pack: input.pack });
        return p.reindex ? await modelsDeps.startIndex(project) : null;
      };
      if (!p.download.length && !llama) {
        const id = await activate();
        return { ...out, jobIds: id ? [id] : [], dryRun: false };
      }
      const { job } = startJob("models-usePack", input.pack, project, async (jctx) => {
        for (const d of p.download) await pull(jctx, { model: d.model });
        if (llama) await pullLlama(jctx, "auto");
        const index = await activate();
        return { pack: input.pack, variant: r.variantIndex, indexJob: index };
      });
      return { ...out, jobIds: [job.id], dryRun: false };
    },
  }),
  command({
    name: "models.hardware",
    summary: "This PC's profile: RAM, CPU, GPUs with total and free VRAM, free disk per drive, loaded models.",
    input: z.object({ refresh: z.boolean().default(false).describe("Measure again instead of the cached profile") }),
    output: z.object({
      at: z.string(),
      ramTotalMB: z.number(),
      ramFreeMB: z.number(),
      cpu: z.object({ model: z.string(), threads: z.number() }),
      gpus: z.array(
        z.object({
          name: z.string(),
          vendor: z.enum(["nvidia", "amd", "intel", "other"]),
          driver: z.string().optional(),
          vramTotalMB: z.number().nullable(),
          vramUsedMB: z.number().nullable(),
          source: z.enum(["nvidia-smi", "wmi", "registry"]),
        }),
      ),
      drives: z.array(z.object({ root: z.string(), freeMB: z.number(), totalMB: z.number() })),
      loaded: z.array(
        z.object({
          name: z.string(),
          sizeMB: z.number(),
          vramMB: z.number(),
          runtime: z.literal("llamacpp"),
        }),
      ),
    }),
    mutates: false,
    global: true,
    run: async (_ctx, input) => machineProfile({ refresh: input.refresh }),
  }),
  command({
    name: "models.fit",
    summary:
      "Will it fit? For one model or an embedding + reranker pair: fits · tight · GPU too small · RAM too small.",
    input: z.object({
      embedding: z.string().optional().describe("Catalog id"),
      reranker: z.string().optional().describe("Catalog id"),
    }),
    output: fit,
    mutates: false,
    global: true,
    async run(_ctx, input) {
      const entries = entriesOf([input.embedding, input.reranker]);
      if (!entries.length)
        throw new UserError("Name a model.", "testimus models fit --embedding <id> [--reranker <id>]");
      return fitOf(entries, await machineProfile(), { headroom: budgets().headroom, lines: readPerf() });
    },
  }),
  command({
    name: "models.perf",
    summary: "Timings recorded on this PC per operation and model: count, p50, p95, throughput, memory.",
    input: z.object({ model: z.string().optional().describe("Only this catalog id") }),
    output: z.array(
      z.object({
        op: z.string(),
        model: z.string(),
        device: z.string(),
        count: z.number(),
        p50: z.number(),
        p95: z.number(),
        perSecond: z.number(),
        peakMB: z.number().nullable(),
        partialOffload: z.boolean(),
        oom: z.number().describe("Operations that failed for lack of memory"),
      }),
    ),
    mutates: false,
    global: true,
    run: async (_ctx, input) => perfStats({ model: input.model }),
  }),
  command({
    name: "models.advice",
    summary: "Upgrade or downgrade suggestions from the timings, the fit and the benchmark; never switches by itself.",
    input: z.object({}),
    output: z.array(
      z.object({
        id: z.string(),
        direction: z.enum(["upgrade", "downgrade"]),
        from: choice,
        to: choice,
        reason: z.string(),
        quality: z.string(),
      }),
    ),
    mutates: false,
    async run(ctx) {
      return (await adviceList(projectOf(ctx))).map(({ metric: _m, ...a }) => a);
    },
  }),
  command({
    name: "models.dismiss",
    summary: "Dismiss an advice; it comes back only when its numbers change by more than 25 %.",
    input: z.object({ id: z.string().describe("Advice id from models.advice") }),
    output: z.object({ dismissed: z.string() }),
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
