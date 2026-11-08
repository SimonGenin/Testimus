import { z } from "zod";
import { command } from "../command.ts";
import { applySetDir, planSetDir } from "../lib/models-dir.ts";
import { catalogView, list, remove, verify } from "../lib/models-install.ts";
import { addPath } from "../lib/models-install-path.ts";
import { pull } from "../lib/models-install-pull.ts";
import { withPerfScope } from "../lib/models-perf.ts";
import { modelsDir, runtimesDir } from "../lib/models-registry.ts";
import { pullLlama } from "../lib/models-use.ts";
import { commands as machine } from "./models-machine.ts";
import { commands as packs } from "./models-packs.ts";
import { dirInput, dirOut, fit, MB, modelId, state } from "./models-schemas.ts";
import { commands as usage } from "./models-usage.ts";

const own = [
  command({
    name: "models.catalog",
    summary: "The model catalog, with whether each entry fits this PC (RAM, GPU) and its tier.",
    input: z.object({ kind: z.enum(["embedding", "reranker"]).optional().describe("Only this kind") }),
    output: z.array(
      z
        .object({
          id: modelId,
          kind: z.enum(["embedding", "reranker"]).describe("embedding (vectors for search) or reranker (reorders)"),
          label: z.string().describe("Its name in words"),
          tier: z.string().describe("light · balanced · quality: how heavy it is"),
          runtimes: z.array(z.string()).describe("What runs it: transformers (ONNX) or llamacpp (GGUF)"),
          quantization: z.string().describe("Its precision (fp16, q8, Q4_K_M…)"),
          dims: z.number().describe("Dimensions of its vectors"),
          sizeMB: z.number().describe("Download size in MB"),
          state,
          fit,
        })
        .describe("One catalog entry"),
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
      z
        .object({
          model: modelId,
          label: z.string().describe("Its name in words"),
          via: z
            .enum(["path", "download"])
            .describe("path (registered where it is) or download (in the models folder)"),
          runtime: z.string().describe("transformers or llamacpp"),
          where: z.string().describe("Its folder or file"),
          sizeMB: z.number().describe("Size on disk in MB"),
          state,
          usedBy: z.array(z.string()).describe("Project folders that use it on this PC"),
          perf: z.string().optional().describe("« on this PC: query 40 ms, index 120 passages/s »"),
        })
        .describe("One installed model"),
    ),
    mutates: false,
    global: true,
    run: async () => list(),
  }),
  command({
    name: "models.dirs",
    summary: "Where this PC keeps the downloaded models and the llama.cpp runtimes (null while not chosen).",
    input: z.object({}),
    output: z.object({
      dir: z.string().nullable().describe("The models folder (null = not chosen yet: the first download asks)"),
      runtimesDir: z
        .string()
        .nullable()
        .describe("The llama.cpp runtimes folder (its own, else runtimes/ in the models folder; null = neither)"),
    }),
    mutates: false,
    global: true,
    run: async () => ({ dir: modelsDir() ?? null, runtimesDir: runtimesDir() ?? null }),
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
    output: z.object({
      model: z.string().describe("Catalog id it was registered as (llama.cpp for a runtime folder)"),
      via: z.literal("path").describe("Registered where it is"),
      path: z.string().describe("The registered folder or file"),
      dims: z.number().describe("Dimensions it answered with (0 for llama.cpp)"),
      state,
    }),
    mutates: true,
    global: true,
    positional: ["path"],
    run: async (ctx, input) => withPerfScope({}, () => addPath(input, ctx), ctx.signal),
  }),
  command({
    name: "models.pull",
    summary: "Download a catalog model (SHA-256 checked); a job. Stops if the models folder is not chosen.",
    input: z.object({
      model: modelId,
      dir: z.string().optional().describe("Models folder for this download (sets it when not chosen yet)"),
      dtype: z.string().optional().describe("transformers models: the dtype to fetch (default from the catalog)"),
    }),
    output: z.object({
      model: modelId,
      via: z.string().describe("download, or path when it was already on this PC"),
      where: z.string().describe("Its folder or file"),
      sizeMB: z.number().describe("Size on disk in MB"),
      state,
    }),
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
    output: z.object({
      exe: z.string().describe("Path of llama-server.exe"),
      build: z.string().describe("llama.cpp build tag"),
      backend: z.enum(["cuda", "vulkan", "cpu"]).describe("The backend downloaded"),
    }),
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
    input: z.object({ model: modelId }),
    output: z.object({
      model: modelId,
      removed: z
        .enum(["files", "registration"])
        .describe("files (a download deleted) or registration (a path forgotten)"),
      freedMB: z.number().describe("Disk space freed, in MB"),
    }),
    mutates: true,
    global: true,
    positional: ["model"],
    run: async (_ctx, input) => remove(input.model),
  }),
  command({
    name: "models.verify",
    summary:
      "Probe a model: load it, embed one sentence, check the dimension and the fingerprint; records verified or broken. A job.",
    input: z.object({ model: modelId }),
    output: z.object({
      model: modelId,
      ok: z.boolean().describe("It loaded and answered as the catalog says"),
      dims: z.number().describe("Dimensions it answered with"),
      ms: z.number().describe("How long the load and the answer took"),
      message: z.string().describe("What happened, in words"),
    }),
    mutates: true,
    global: true,
    job: "models-verify",
    positional: ["model"],
    subject: (i) => i.model,
    run: async (ctx, input) => {
      ctx.progress({ message: `Loading ${input.model}` });
      return verify(input.model);
    },
  }),
  command({
    name: "models.planDir",
    summary:
      "What choosing or changing the models folder (or the runtimes folder) would do: the drive, its free space, what moves, stays or is copied. Changes nothing.",
    input: z.object(dirInput),
    output: dirOut,
    mutates: false,
    global: true,
    positional: ["dir"],
    run: async (_ctx, input) => {
      const p = planSetDir({ ...input, dryRun: true });
      return { dir: p.dir, drive: p.drive, installedMB: p.installedMB, action: p.action, files: p.files };
    },
  }),
  command({
    name: "models.setDir",
    summary:
      "Choose or change the models folder (or the runtimes folder); existing downloads move, stay or are copied. A job: a move or a copy can be cancelled, and then nothing changed.",
    input: z.object(dirInput),
    output: dirOut.extend({
      cancelled: z.boolean().describe("The move or copy was cancelled: the old copy is intact and nothing changed"),
    }),
    mutates: true,
    global: true,
    job: "models-dir",
    positional: ["dir"],
    subject: (i) => (i.copy ? `copy to ${i.dir}` : i.move ? `move to ${i.dir}` : i.dir),
    async run(ctx, input) {
      const p = planSetDir({ ...input, dryRun: false, job: ctx.jobId });
      const verb = p.action === "move" ? "Moving" : "Copying";
      const r = await applySetDir(p, {
        signal: ctx.signal,
        onProgress: (d, total, what) =>
          ctx.progress({ message: `${verb} ${what}`, done: Math.round(d / MB), total: Math.round(total / MB) }),
      });
      return {
        dir: p.dir,
        drive: p.drive,
        installedMB: p.installedMB,
        action: p.action,
        files: p.files,
        cancelled: r.cancelled,
      };
    },
  }),
];

export const commands = [...own, ...packs, ...machine, ...usage];
