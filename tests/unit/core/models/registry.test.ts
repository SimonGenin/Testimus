import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog, registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { downloadDeps } from "../../../../src/core/lib/models-download.ts";
import {
  dropInstall,
  installsOf,
  putInstall,
  readRegistry,
  runtimesDir,
  writeRegistry,
} from "../../../../src/core/lib/models-registry.ts";
import { findModel, isComplete } from "../../../../src/core/lib/models-store.ts";
import type { CatalogEntry, Installation } from "../../../../src/core/types.ts";

const saved = { ...downloadDeps };
const REV = "0123456789abcdef0123456789abcdef01234567";
let dir = "";

const inst = (model: string, via: Installation["via"]): Installation => ({
  model,
  via,
  runtime: "transformers",
  path: join(dir, model),
  status: "installed",
});

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  mkdirSync(join(registryFile(), ".."), { recursive: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-reg-"));
});
afterEach(() => {
  Object.assign(downloadDeps, saved);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("registry helpers", () => {
  it("installsOf, dropInstall with and without a via, runtimesDir", () => {
    putInstall(inst("m", "path"));
    putInstall(inst("m", "download"));
    putInstall(inst("n", "path"));
    expect(installsOf("m").map((i) => i.via)).toEqual(["path", "download"]);
    dropInstall("m", "download");
    expect(installsOf("m").map((i) => i.via)).toEqual(["path"]);
    dropInstall("m");
    expect(installsOf("m")).toEqual([]);
    expect(installsOf("n")).toHaveLength(1);
    expect(runtimesDir({ installs: [] })).toBeUndefined();
    expect(runtimesDir({ installs: [], dir: "D:\\m" })).toBe(join("D:\\m", "runtimes"));
    expect(runtimesDir({ installs: [], dir: "D:\\m", runtimesDir: "E:\\r" })).toBe("E:\\r");
  });
});

describe("models-store", () => {
  const model = (root: string, files: string[]) => {
    for (const f of files) {
      mkdirSync(join(root, f, ".."), { recursive: true });
      writeFileSync(join(root, f), "x");
    }
    return root;
  };

  it("isComplete needs config, tokenizer and an onnx folder with the wanted file", () => {
    const m = model(join(dir, "m"), ["config.json", "tokenizer.json"]);
    expect(isComplete(m)).toBe(false);
    model(m, ["onnx/model_fp16.onnx"]);
    expect(isComplete(m)).toBe(true);
    expect(isComplete(m, "q8")).toBe(false);
    expect(isComplete(m, "odd")).toBe(true);
  });

  it("finds a model under TESTIMUS_MODELS", () => {
    model(join(dir, "acme", "found"), ["config.json", "tokenizer.json", "onnx/model.onnx"]);
    vi.stubEnv("TESTIMUS_MODELS", dir);
    expect(findModel("acme/found")?.root.kind).toBe("env");
    expect(findModel("acme/found")?.dir).toBe(join(dir, "acme", "found"));
  });

  it("lists the catalog entries models.json adds", () => {
    const sha = "0".repeat(64);
    const body = Buffer.from("{}");
    const e = {
      id: "plain-onnx",
      kind: "embedding",
      label: "Plain",
      runtimes: ["transformers"],
      source: {
        hf: {
          repo: "acme/plain",
          revision: REV,
          files: [
            { path: "config.json", sha256: sha, size: body.length },
            { path: "tokenizer.json", sha256: sha, size: body.length },
          ],
        },
      },
      dims: 8,
      size: { downloadMB: 1, ramMB: 1, vramMB: 1 },
    } as unknown as CatalogEntry;
    writeRegistry({ ...readRegistry(), dir, catalog: [e] });
    expect(catalog().entries.map((x) => x.id)).toContain("plain-onnx");
  });
});
