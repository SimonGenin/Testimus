import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.ts";
import { registryFile } from "./models-catalog.ts";
import { readJson } from "./project.ts";

export type ModelRoot = { kind: "dir" | "env" | "user" | "release"; dir: string };
export type ModelHit = { root: ModelRoot; dir: string };

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
