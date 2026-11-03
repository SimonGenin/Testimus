import type { DatabaseSync } from "node:sqlite";
import { onnxFile } from "../lib/models-store.ts";
import type { ResolvedModel, SpaceFingerprint, VectorSpace } from "../types.ts";
import { getSpace, RECIPE, spaceId } from "./db.ts";

export function dimsOf(m: ResolvedModel): number {
  return m.install.dims ?? m.entry.dims;
}

export function instruction(template: string, m: ResolvedModel): string {
  return template.replaceAll("{task}", m.queryTask);
}

function weightFiles(m: ResolvedModel): string[] {
  const files = (m.entry.source.hf?.files ?? []).filter((f) => /\.onnx(_data)?$/.test(f.path));
  const want = onnxFile(m.dtype);
  const own = want ? files.filter((f) => f.path.split("/").pop()?.startsWith(want)) : [];
  return (own.length ? own : files).map((f) => f.sha256).sort();
}

export function modelIdentity(m: ResolvedModel): string {
  const { source } = m.entry;
  if (source.file?.sha256) return `sha256:${source.file.sha256}`;
  if (m.install.sha256) return `sha256:${m.install.sha256}`;
  const weights = weightFiles(m);
  if (weights.length) return weights.map((w) => (w.includes(":") ? w : `sha256:${w}`)).join("+");
  return `hf:${source.hf?.repo ?? m.entry.id}@${source.hf?.revision ?? "?"}:${m.dtype ?? "?"}`;
}

export function fingerprintOf(m: ResolvedModel): SpaceFingerprint {
  const e = m.entry;
  return {
    runtime: m.runtime,
    model: modelIdentity(m),
    modelId: e.id,
    pooling: e.pooling ?? "",
    normalize: e.normalize ?? true,
    queryInstruction: instruction(e.queryInstruction, m),
    docInstruction: instruction(e.docInstruction, m),
    dims: dimsOf(m),
    maxInputTokens: e.maxInputTokens,
    recipe: RECIPE,
  };
}

export function spaceOf(db: DatabaseSync, m: ResolvedModel): VectorSpace | undefined {
  return getSpace(db, spaceId(fingerprintOf(m)));
}
