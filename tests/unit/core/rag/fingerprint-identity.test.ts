import { describe, expect, it } from "vitest";
import { fingerprintOf, modelIdentity } from "../../../../src/core/rag/fingerprint.ts";
import type { CatalogEntry, ResolvedModel } from "../../../../src/core/types.ts";

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({
    id: "m1",
    pooling: undefined,
    normalize: undefined,
    queryInstruction: "Q {task}",
    docInstruction: "",
    dims: 8,
    maxInputTokens: 512,
    source: {},
    ...over,
  }) as CatalogEntry;

const model = (over: Partial<ResolvedModel> = {}, e: Partial<CatalogEntry> = {}): ResolvedModel =>
  ({
    entry: entry(e),
    install: { model: "m1", via: "path", runtime: "transformers", status: "installed" },
    runtime: "transformers",
    device: "cpu",
    queryTask: "find",
    ...over,
  }) as ResolvedModel;

describe("fingerprint identity", () => {
  it("prefers the file hash, then the install hash, then the weights, then the repo", () => {
    expect(modelIdentity(model({ install: { sha256: "abc" } as ResolvedModel["install"] }))).toBe("sha256:abc");
    expect(modelIdentity(model({}, { source: { hf: { repo: "r/x", revision: "v1" } } }))).toBe("hf:r/x@v1:?");
    expect(modelIdentity(model({ dtype: "q8" }))).toBe("hf:m1@?:q8");
    const files = [
      { path: "onnx/model.onnx", sha256: "b", size: 1 },
      { path: "onnx/model_quantized.onnx", sha256: "sha256:a", size: 1 },
      { path: "tokenizer.json", sha256: "c", size: 1 },
    ];
    const hf = { repo: "r", revision: "v", files };
    expect(modelIdentity(model({ dtype: "q8" }, { source: { hf } }))).toBe("sha256:a");
    expect(modelIdentity(model({ dtype: "bnb4" }, { source: { hf } }))).toBe("sha256:b+sha256:a");
    expect(modelIdentity(model({}, { source: { hf } }))).toBe("sha256:b+sha256:a");
  });

  it("defaults pooling and normalization and reads installed dimensions", () => {
    const fp = fingerprintOf(model({ install: { dims: 4 } as ResolvedModel["install"] }));
    expect(fp).toMatchObject({ pooling: "", normalize: true, dims: 4, queryInstruction: "Q find" });
  });
});
