import { z } from "zod";

export const MB = 1024 * 1024;

export const modelId = z.string().describe("Catalog id of the model");

export const fit = z
  .object({
    verdict: z
      .enum(["fits", "tight", "gpu-too-small", "ram-too-small", "unknown", "untested", "unsupported"])
      .describe(
        "fits · tight (fits once loaded models are unloaded, or without the safety margin) · gpu-too-small · ram-too-small · unknown (the GPU memory cannot be read) · untested (never run on this system) · unsupported (this system cannot run it)",
      ),
    device: z.enum(["gpu", "cpu"]).describe("Where it would run: the GPU, or the processor"),
    needMB: z
      .object({
        vram: z.number().describe("GPU memory it needs, in MB (measured on this PC when known, else the catalog's)"),
        ram: z.number().describe("Memory it needs, in MB"),
      })
      .describe("What it needs"),
    freeMB: z
      .object({
        vram: z.number().nullable().describe("Free GPU memory in MB (null = not on the GPU, or unknown)"),
        ram: z.number().describe("Free memory in MB"),
      })
      .describe("What is free now"),
    totalMB: z
      .object({
        vram: z.number().nullable().describe("GPU memory in MB (null = not on the GPU, or unknown)"),
        ram: z.number().describe("Memory of this PC in MB"),
      })
      .describe("What this PC has"),
    unload: z.array(z.string()).describe("Loaded models to unload for a « tight » fit"),
    message: z.string().describe("The verdict in words, with the numbers"),
  })
  .describe("Whether it fits this PC");

export const state = z
  .enum(["available", "downloading", "installed", "verified", "active", "broken", "outdated"])
  .describe(
    "available (in the catalog, not on this PC) · downloading · installed · verified (it loaded and answered here) · active (a project uses it) · broken (missing or changed files) · outdated",
  );

export const choice = z
  .union([
    z.object({ pack: z.string().describe("Pack id") }),
    z.object({
      embedding: z.string().describe("Catalog id of the embedding"),
      reranker: z.string().nullable().describe("Catalog id of the reranker (null = none)"),
    }),
  ])
  .describe("A pack, or an embedding with its reranker");

export const plan = z
  .object({
    download: z
      .array(z.object({ model: modelId, sizeMB: z.number().describe("Download size in MB") }).describe("One download"))
      .describe("Catalog models to download first"),
    dir: z.string().nullable().describe("Where downloads go (null = the storage folder is not chosen yet)"),
    reindex: z.boolean().describe("A new vector space will be built"),
    expected: z.string().describe("Expected speed on this PC when the journal knows it"),
  })
  .describe("What using it takes");

export const packOut = {
  pack: z.string().describe("Pack id"),
  variant: z.number().describe("Index of the pack's variant that applies on this PC"),
  embedding: modelId.describe("The variant's embedding"),
  reranker: z.string().nullable().describe("The variant's reranker (null = none)"),
  plan,
};

export const dirInput = {
  dir: z.string().describe("Absolute folder, outside any project folder"),
  runtimes: z.boolean().default(false).describe("Set the llama.cpp runtimes folder instead of the models folder"),
  move: z.boolean().default(false).describe("Move the downloaded models there (what the page does when changing)"),
  keep: z.boolean().default(false).describe("Leave them where they are; only new downloads go there"),
  copy: z.boolean().default(false).describe("Copy them there and keep the old copy"),
};

export const dirOut = z.object({
  dir: z.string().describe("The folder, as an absolute path"),
  drive: z
    .object({
      root: z.string().describe("The drive (or root) it is on"),
      freeMB: z.number().describe("Free space on it, in MB"),
    })
    .describe("The drive of the folder"),
  installedMB: z.number().describe("Size of the downloads already in the old folder, in MB"),
  action: z
    .enum(["set", "move", "keep", "copy"])
    .describe("set (nothing downloaded yet) · move · keep (they stay, now registered as paths) · copy"),
  files: z.number().describe("Files to move or copy"),
});
