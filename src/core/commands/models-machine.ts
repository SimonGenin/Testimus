import { z } from "zod";
import { command, UserError } from "../command.ts";
import { fitOf } from "../lib/fit/verdict.ts";
import { rankGpus } from "../lib/machine/gpus.ts";
import { machineProfile } from "../lib/machine/profile.ts";
import { perfStats, readPerf } from "../lib/models-perf.ts";
import { budgets } from "../lib/models-registry.ts";
import { entriesOf } from "../lib/models-use.ts";
import { fit } from "./models-schemas.ts";

export const commands = [
  command({
    name: "models.hardware",
    summary: "This PC's profile: system, RAM, CPU, GPUs with total and free VRAM, free disk per drive, loaded models.",
    input: z.object({ refresh: z.boolean().default(false).describe("Measure again instead of the cached profile") }),
    output: z.object({
      at: z.string().describe("When it was measured (ISO date)"),
      system: z
        .object({
          platform: z.string().describe("win32, darwin, linux"),
          arch: z.string().describe("x64, arm64"),
        })
        .optional()
        .describe("Node's platform and architecture; absent means Windows x64"),
      onnx: z
        .string()
        .nullable()
        .optional()
        .describe("The onnxruntime version that loads here (null = none loads; absent = not checked)"),
      ramTotalMB: z.number().describe("Memory in MB"),
      ramFreeMB: z.number().describe("Free memory in MB"),
      cpu: z
        .object({
          model: z.string().describe("Processor name"),
          threads: z.number().describe("Hardware threads"),
        })
        .describe("The processor"),
      gpus: z
        .array(
          z
            .object({
              name: z.string().describe("Adapter name"),
              vendor: z.enum(["nvidia", "amd", "intel", "other"]).describe("Its maker"),
              driver: z.string().optional().describe("Driver version"),
              vramTotalMB: z.number().nullable().describe("GPU memory in MB (null = unknown)"),
              vramUsedMB: z.number().nullable().describe("GPU memory in use in MB (null = unknown)"),
              source: z
                .enum(["nvidia-smi", "wmi", "registry", "llama.cpp"])
                .describe("Where the figures come from (llama.cpp: the free memory the installed llama.cpp sees)"),
              integrated: z
                .boolean()
                .optional()
                .describe("An integrated GPU: it has no memory of its own and uses the PC's"),
            })
            .describe("One graphics adapter"),
        )
        .describe(
          "The graphics adapters, in the order models are placed on them: the first usable one is where they run",
        ),
      drives: z.array(
        z
          .object({
            root: z.string().describe("Drive root (C:\\) or, outside Windows, the home folder"),
            freeMB: z.number().describe("Free space in MB"),
            totalMB: z.number().describe("Size in MB"),
          })
          .describe("One drive"),
      ),
      loaded: z.array(
        z
          .object({
            name: z.string().describe("The model a llama.cpp server holds"),
            sizeMB: z.number().describe("Its size in MB"),
            vramMB: z.number().describe("GPU memory it holds in MB"),
            runtime: z.literal("llamacpp").describe("The runtime holding it"),
          })
          .describe("One loaded model"),
      ),
    }),
    mutates: false,
    global: true,
    run: async (_ctx, input) => {
      const p = await machineProfile({ refresh: input.refresh });
      return { ...p, gpus: rankGpus(p.gpus) };
    },
  }),
  command({
    name: "models.fit",
    summary:
      "Will it fit? For one model or an embedding + reranker pair: fits · tight · GPU too small · RAM too small · untested on this system · not supported on this system.",
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
      z
        .object({
          op: z.string().describe("The operation: model.load, embed.index, embed.query, rerank"),
          model: z.string().describe("Catalog id"),
          device: z.string().describe("Where it ran: gpu, dml, cpu"),
          count: z.number().describe("Operations recorded"),
          p50: z.number().describe("Median time in ms"),
          p95: z.number().describe("95th percentile time in ms"),
          perSecond: z.number().describe("Items per second"),
          peakMB: z.number().nullable().describe("Peak memory in MB (null = not measured)"),
          partialOffload: z.boolean().describe("llama.cpp kept part of the model on the processor"),
          oom: z.number().describe("Operations that failed for lack of memory"),
        })
        .describe("One operation of one model"),
    ),
    mutates: false,
    global: true,
    run: async (_ctx, input) => perfStats({ model: input.model }),
  }),
];
