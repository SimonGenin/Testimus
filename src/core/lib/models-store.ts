import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { registryFile } from "./models-catalog.ts";
import { readJson } from "./project.ts";

export type ModelRoot = { kind: "dir" | "env" | "user" | "release"; dir: string };
export type ModelHit = { root: ModelRoot; dir: string };
export type PullProgress = { file: string; loaded?: number; total?: number };

const SUFFIX: Record<string, string> = {
  fp32: "",
  fp16: "_fp16",
  int8: "_int8",
  uint8: "_uint8",
  q8: "_quantized",
  q4: "_q4",
  q4f16: "_q4f16",
  bnb4: "_bnb4",
};

export function userModelsDir(): string {
  return join(env.localDir(), "models");
}

export function releaseModelsDir(): string {
  return fileURLToPath(new URL("../../../.models/", import.meta.url));
}

export function modelRoots(): ModelRoot[] {
  const roots: ModelRoot[] = [];
  const chosen = readJson<{ dir?: string }>(registryFile(), {}).dir;
  if (chosen) roots.push({ kind: "dir", dir: chosen });
  if (process.env.TESTIMUS_MODELS) roots.push({ kind: "env", dir: process.env.TESTIMUS_MODELS });
  roots.push({ kind: "user", dir: userModelsDir() });
  roots.push({ kind: "release", dir: releaseModelsDir() });
  return roots;
}

export function modelDir(root: string, hfId: string): string {
  return join(root, ...hfId.split("/"));
}

export function onnxFile(dtype: string | undefined): string | null {
  if (!dtype || !(dtype in SUFFIX)) return null;
  return `model${SUFFIX[dtype]}.onnx`;
}

export function isComplete(dir: string, dtype?: string): boolean {
  if (!existsSync(join(dir, "config.json")) || !existsSync(join(dir, "tokenizer.json"))) return false;
  const onnx = join(dir, "onnx");
  if (!existsSync(onnx)) return false;
  const want = onnxFile(dtype);
  if (want) return existsSync(join(onnx, want));
  return readdirSync(onnx).some((f) => f.endsWith(".onnx"));
}

export function findModel(hfId: string, dtype?: string): ModelHit | null {
  for (const root of modelRoots()) {
    const dir = modelDir(root.dir, hfId);
    if (isComplete(dir, dtype)) return { root, dir };
  }
  return null;
}

// ponytail: v1 callers (the transformers runtime) land here; the files now come from the pinned catalog revision
// into the models folder the user chose (P6), never into %LOCALAPPDATA% by default
export async function pullModel(
  hfId: string,
  dtype: string | undefined,
  opts: { allowRemote: boolean; onProgress?(p: PullProgress): void; signal?: AbortSignal },
): Promise<ModelHit> {
  const hit = findModel(hfId, dtype);
  if (hit) return hit;
  if (!opts.allowRemote)
    throw new UserError(
      `${hfId} is not on this PC and downloads are off (settings.models.allowRemote = false).`,
      `Copy the folder ${hfId} from the team share and register it: testimus models add <folder>.`,
    );
  const { catalog } = await import("./models-catalog.ts");
  const { readRegistry, putInstall } = await import("./models-registry.ts");
  const { pullFiles } = await import("./models-download.ts");
  const entry = catalog().entries.find(
    (e) =>
      e.source.hf?.repo === hfId && e.runtimes.includes("transformers") && (!dtype || e.dtypeByDevice?.cpu === dtype),
  );
  if (!entry?.source.hf) throw new UserError(`${hfId} (${dtype ?? "any dtype"}) is not in the model catalog.`);
  const dir = readRegistry().dir;
  if (!dir)
    throw new UserError(
      "Choose where models are stored: `testimus models setDir <folder>`",
      "Then run the index again, or download it now: testimus models pull <id>.",
    );
  const res = await pullFiles(entry, dir, {
    dtype,
    signal: opts.signal ?? new AbortController().signal,
    onProgress: (loaded, total, file) => opts.onProgress?.({ file, loaded, total }),
  });
  putInstall({
    model: entry.id,
    via: "download",
    runtime: "transformers",
    path: res.path,
    revision: entry.source.hf.revision,
    ...(entry.dtypeByDevice?.cpu ? { dtype: entry.dtypeByDevice.cpu } : {}),
    device: "cpu",
    status: "installed",
  });
  return { root: { kind: "user", dir }, dir: res.path };
}
