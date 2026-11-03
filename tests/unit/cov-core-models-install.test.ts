import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../../src/core/command.ts";
import { quietCtx } from "../../src/core/command.ts";
import { env } from "../../src/core/env.ts";
import { registryFile } from "../../src/core/lib/models-catalog.ts";
import { downloadDeps } from "../../src/core/lib/models-download.ts";
import { pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import {
  addPath,
  catalogView,
  installDeps,
  list,
  needEntry,
  pull,
  remove,
  usedBy,
  verify,
} from "../../src/core/lib/models-install.ts";
import { readRegistry, writeRegistry } from "../../src/core/lib/models-registry.ts";
import { readSettings, writeSettings } from "../../src/core/lib/project.ts";
import type { CatalogEntry, Installation, MachineProfile } from "../../src/core/types.ts";

const savedInstall = { ...installDeps };
const savedDownload = { ...downloadDeps };
const REV = "0123456789abcdef0123456789abcdef01234567";
const GGUF = Buffer.alloc(1000, 71);
const ONNX = Buffer.from("onnx bytes");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const CPU: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 16000,
  ramFreeMB: 8000,
  cpu: { model: "cpu", threads: 8 },
  gpus: [],
  drives: [],
  loaded: [],
};

const base = {
  kind: "embedding" as const,
  family: "tiny",
  licence: "MIT",
  commercialUse: true,
  quantization: "Q8_0",
  dims: 8,
  maxInputTokens: 512,
  queryInstruction: "",
  docInstruction: "",
  size: { downloadMB: 3, ramMB: 10, vramMB: 10 },
  devices: ["cpu" as const],
  tier: "light" as const,
};
const GG: CatalogEntry = {
  ...base,
  id: "cov-gguf",
  label: "Cov GGUF",
  runtimes: ["llamacpp"],
  source: {
    hf: { repo: "acme/Cov-GGUF", revision: REV, path: "cov.gguf" },
    file: { sha256: sha(GGUF), size: GGUF.length },
  },
};
const ON: CatalogEntry = {
  ...base,
  id: "cov-onnx",
  label: "Cov ONNX",
  runtimes: ["transformers"],
  dtypeByDevice: { cpu: "q8" },
  dimsOptions: [16],
  source: {
    hf: {
      repo: "acme/cov-onnx",
      revision: REV,
      files: [
        { path: "config.json", sha256: sha(ONNX), size: ONNX.length },
        { path: "tokenizer.json", sha256: sha(ONNX), size: ONNX.length },
        { path: "onnx/model_quantized.onnx", sha256: sha(ONNX), size: ONNX.length },
      ],
    },
  },
};
const NOHF: CatalogEntry = { ...base, id: "cov-nohf", label: "Cov no source", runtimes: ["transformers"], source: {} };

let dir = "";
let models = "";
let probeDims = 8;
const put = (path: string, body: string | Buffer) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  return path;
};
const onnxFolder = (root: string, withOnnx = true) => {
  put(join(root, "config.json"), ONNX);
  put(join(root, "tokenizer.json"), ONNX);
  if (withOnnx) put(join(root, "onnx", "model_quantized.onnx"), ONNX);
  return root;
};
const registry = (over: Partial<Parameters<typeof writeRegistry>[0]> = {}) =>
  writeRegistry({ installs: [], catalog: [GG, ON, NOHF], ...over });
const inst = (o: Partial<Installation> & Pick<Installation, "model">): Installation => ({
  via: "download",
  runtime: "transformers",
  status: "installed",
  ...o,
});

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-install-"));
  models = join(dir, "models");
  mkdirSync(models);
  vi.stubEnv("TESTIMUS_MODELS", join(dir, "env-models"));
  vi.stubEnv("TESTIMUS_MACHINE", "");
  pinMachineProfile(CPU);
  probeDims = 8;
  installDeps.probe = async () => ({ dims: probeDims, maxTokens: 512 });
  installDeps.findLlamaBuild = async () => null;
  registry();
});
afterEach(() => {
  Object.assign(installDeps, savedInstall);
  Object.assign(downloadDeps, savedDownload);
  pinMachineProfile(null);
  vi.unstubAllEnvs();
  env.mock = false;
  rmSync(dir, { recursive: true, force: true });
});

describe("installDeps defaults", () => {
  it("probes with the mock runtime and finds no llama.cpp build in an empty folder", async () => {
    Object.assign(installDeps, savedInstall);
    env.mock = true;
    const p = await installDeps.probe({
      entry: ON,
      install: inst({ model: ON.id }),
      runtime: "transformers",
      device: "cpu",
      queryTask: "q",
    });
    expect(p.dims).toBeGreaterThan(0);
    expect(await installDeps.findLlamaBuild(dir)).toBeNull();
  });
});

describe("addPath — refusals", () => {
  it("refuses an unknown id, a relative path, a missing path, an unreadable llama.cpp build and a non-gguf file", async () => {
    expect(() => needEntry("nope")).toThrow(/Unknown model nope/);
    await expect(addPath({ path: "rel/x", copy: false })).rejects.toThrow(/not an absolute path/);
    await expect(addPath({ path: join(dir, "absent"), copy: false })).rejects.toThrow(/does not exist/);
    put(join(dir, "llama", "llama-server.exe"), "x");
    await expect(addPath({ path: join(dir, "llama"), copy: false })).rejects.toThrow(/build could not be read/);
    await expect(addPath({ path: put(join(dir, "x.bin"), "x"), copy: false })).rejects.toThrow(/not a \.gguf file/);
  });

  it("refuses a folder that is not a model, one that matches nothing, and a named one that lacks files", async () => {
    mkdirSync(join(dir, "empty"));
    await expect(addPath({ path: join(dir, "empty"), copy: false })).rejects.toThrow(/not a Hugging Face model folder/);
    onnxFolder(join(dir, "unknown-name"), false);
    await expect(addPath({ path: join(dir, "unknown-name"), copy: false })).rejects.toThrow(/matches no catalog entry/);
    await expect(addPath({ path: join(dir, "unknown-name"), model: ON.id, copy: false })).rejects.toThrow(
      /lacks files of Cov ONNX/,
    );
  });

  it("a gguf named with --model whose bytes differ is refused", async () => {
    const f = put(join(dir, "other.gguf"), "different bytes");
    await expect(addPath({ path: f, model: GG.id, copy: false })).rejects.toThrow(/does not match Cov GGUF/);
  });
});

describe("addPath — registering", () => {
  it("a folder found by its name, with its probe ok through dimsOptions, and an unreadable machine profile", async () => {
    const machine = put(join(dir, "machine.json"), "{ not json");
    vi.stubEnv("TESTIMUS_MACHINE", machine);
    pinMachineProfile(null);
    const root = onnxFolder(join(dir, "cov-onnx"));
    writeFileSync(join(root, "onnx", "model_quantized.onnx"), "other size bytes");
    probeDims = 16;
    const r = await addPath({ path: root, copy: false });
    expect(r).toMatchObject({ model: ON.id, state: "verified", dims: 16 });
  });

  it("a gguf file found by its size and checksum is registered for llama.cpp with its SHA-256", async () => {
    const f = put(join(dir, "any-name.gguf"), GGUF);
    const r = await addPath({ path: f, copy: false });
    expect(r).toMatchObject({ model: GG.id, state: "verified" });
    expect(readRegistry().installs[0]).toMatchObject({ runtime: "llamacpp", sha256: sha(GGUF), revision: REV });
  });

  it("a reranker answers with any dimension count", async () => {
    const body = Buffer.alloc(777, 3);
    const rr: CatalogEntry = {
      ...GG,
      id: "cov-rr",
      kind: "reranker",
      label: "Cov reranker",
      source: { file: { sha256: sha(body), size: body.length } } as CatalogEntry["source"],
    };
    registry({ catalog: [GG, ON, NOHF, rr] });
    probeDims = 1;
    const r = await addPath({ path: put(join(dir, "rr.gguf"), body), copy: false });
    expect(r).toMatchObject({ model: "cov-rr", state: "verified", dims: 1 });
    expect(readRegistry().installs[0].revision).toBeUndefined();
  });

  it("a probe that fails registers the model unverified, with a warning", async () => {
    installDeps.probe = async () => {
      throw "no runtime";
    };
    const warns: string[] = [];
    const ctx: Ctx = { ...quietCtx(null), log: (_l, m) => warns.push(m) };
    const r = await addPath({ path: onnxFolder(join(dir, "m1")), model: ON.id, copy: false }, ctx);
    expect(r.state).toBe("installed");
    expect(warns[0]).toMatch(/registered but not verified: no runtime/);
  });

  it("a wrong dimension count is not verified", async () => {
    probeDims = 99;
    const r = await addPath({ path: onnxFolder(join(dir, "m2")), model: ON.id, copy: false });
    expect(r.state).toBe("installed");
  });

  it("--copy needs a models folder, refuses an existing target, then copies with progress", async () => {
    const src = onnxFolder(join(dir, "src-onnx"));
    await expect(addPath({ path: src, model: ON.id, copy: true })).rejects.toThrow(
      /Choose where models are stored first/,
    );
    registry({ dir: models });
    mkdirSync(join(models, "acme", "cov-onnx"), { recursive: true });
    await expect(addPath({ path: src, model: ON.id, copy: true })).rejects.toThrow(/already exists/);
    rmSync(join(models, "acme"), { recursive: true });
    const seen: string[] = [];
    const ctx: Ctx = { ...quietCtx(null), progress: (p) => seen.push(p.message) };
    const r = await addPath({ path: src, model: ON.id, copy: true }, ctx);
    expect(r.path).toBe(join(models, "acme", "cov-onnx"));
    expect(seen).toContain("Copying src-onnx");
  });
});

describe("pull", () => {
  it("refuses an entry without a source, and reports progress once per percent", async () => {
    registry({ dir: models });
    await expect(pull(quietCtx(null), { model: NOHF.id })).rejects.toThrow(/no Hugging Face source/);
    const machine = put(join(dir, "machine.json"), "{ not json");
    vi.stubEnv("TESTIMUS_MACHINE", machine);
    pinMachineProfile(null);
    downloadDeps.freeMB = () => 1e9;
    downloadDeps.fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < GGUF.length; i += 5) c.enqueue(new Uint8Array(GGUF.subarray(i, i + 5)));
            c.close();
          },
        }),
        { status: 200 },
      );
    const steps: string[] = [];
    const r = await pull({ ...quietCtx(null), progress: (p) => steps.push(`${p.done}/${p.total}`) }, { model: GG.id });
    expect(r).toMatchObject({ model: GG.id, via: "download", state: "installed" });
    expect(readRegistry().installs[0]).toMatchObject({ runtime: "llamacpp", sha256: sha(GGUF) });
    expect(steps.length).toBeLessThanOrEqual(101);
  });
});

describe("verify", () => {
  it("a model not on this PC, a gguf whose file changed, and a found-on-disk model whose probe fails", async () => {
    expect(await verify(GG.id)).toMatchObject({ ok: false, message: "Cov GGUF is not installed on this PC." });
    const file = put(join(models, "cov.gguf"), "changed");
    registry({ installs: [inst({ model: GG.id, runtime: "llamacpp", path: file })] });
    expect((await verify(GG.id)).message).toMatch(/missing or changed/);
    expect(readRegistry().installs[0].status).toBe("broken");
    registry();
    onnxFolder(join(dir, "env-models", "acme", "cov-onnx"));
    installDeps.probe = async () => {
      throw new Error("cannot load");
    };
    expect(await verify(ON.id)).toMatchObject({ ok: false, message: "cannot load" });
    expect(readRegistry().installs).toEqual([]);
  });
});

describe("remove", () => {
  it("a download whose files are gone frees nothing", async () => {
    registry({ installs: [inst({ model: ON.id, path: join(models, "gone") })] });
    expect(await remove(ON.id)).toEqual({ model: ON.id, removed: "files", freedMB: 0 });
  });

  it("a shared gguf file stays while another installation uses it", async () => {
    const file = put(join(models, "acme", "Cov-GGUF", "cov.gguf"), GGUF);
    registry({
      dir: models,
      installs: [
        inst({ model: GG.id, runtime: "llamacpp", path: file }),
        inst({ model: "someone-else", runtime: "llamacpp", path: file, via: "path" }),
      ],
    });
    expect((await remove(GG.id)).freedMB).toBe(0);
    expect(existsSync(file)).toBe(true);
  });

  it("an unknown co-owner keeps everything but the onnx files", async () => {
    const root = onnxFolder(join(models, "acme", "cov-onnx"));
    registry({
      dir: models,
      installs: [inst({ model: ON.id, path: root }), inst({ model: "unknown-variant", path: root, via: "path" })],
    });
    await remove(ON.id);
    expect(existsSync(join(root, "config.json"))).toBe(true);
    expect(existsSync(join(root, "onnx", "model_quantized.onnx"))).toBe(false);
  });

  it("a known co-owner keeps the files they share", async () => {
    const root = onnxFolder(join(models, "acme", "cov-onnx"));
    const twin: CatalogEntry = { ...ON, id: "cov-onnx-twin", label: "Twin" };
    registry({
      dir: models,
      catalog: [GG, ON, NOHF, twin],
      installs: [inst({ model: ON.id, path: root }), inst({ model: twin.id, path: root })],
    });
    await remove(ON.id);
    expect(existsSync(join(root, "onnx", "model_quantized.onnx"))).toBe(true);
  });
});

describe("usedBy, list and catalogView", () => {
  it("usedBy reads variants, embedding choices and packs", () => {
    writeSettings({
      ...readSettings(),
      rag: {
        byProject: {
          A: { embedding: GG.id, reranker: null },
          B: { pack: "nope" },
          D: { pack: "light" },
          C: { pack: "x", variant: { embedding: "other", reranker: GG.id } },
        },
      },
    });
    expect(usedBy(GG.id)).toEqual(["A", "C"]);
    writeSettings({ ...readSettings(), rag: {} });
  });

  it("list skips unknown models, marks missing paths broken, and counts a path-less install at its download size", async () => {
    registry({
      installs: [
        inst({ model: "not-in-catalog", path: dir }),
        inst({ model: GG.id, runtime: "llamacpp", path: join(dir, "missing.gguf") }),
        inst({ model: ON.id, via: "path" }),
      ],
    });
    const rows = list();
    expect(rows.find((r) => r.model === GG.id)).toMatchObject({ state: "broken" });
    expect(rows.find((r) => r.model === ON.id)).toMatchObject({ sizeMB: 3, state: "broken" });
    expect(rows.some((r) => r.model === "not-in-catalog")).toBe(false);
  });

  it("catalogView names the best state of each entry", async () => {
    const file = put(join(models, "cov.gguf"), GGUF);
    registry({
      installs: [
        inst({ model: GG.id, runtime: "llamacpp", path: file, status: "verified" }),
        inst({ model: ON.id, path: join(dir, "nowhere") }),
      ],
    });
    const view = await catalogView("embedding", CPU);
    expect(view.find((v) => v.id === GG.id)?.state).toBe("verified");
    expect(view.find((v) => v.id === ON.id)?.state).toBe("broken");
    expect(view.find((v) => v.id === NOHF.id)?.state).toBe("available");
    expect(statSync(file).size).toBe(GGUF.length);
    expect((await catalogView()).length).toBeGreaterThan(view.length - 1);
  });
});
