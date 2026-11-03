import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { pinMachineProfile } from "../../../../src/core/lib/models-hardware.ts";
import { installDeps } from "../../../../src/core/lib/models-install.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { modelsDeps } from "../../../../src/core/lib/models-use.ts";
import { readSettings, settingsFile, writeSettings } from "../../../../src/core/lib/project.ts";
import { serverIo, stopAllServers } from "../../../../src/core/rag/runtimes/llama-server.ts";
import { llamacppConfig } from "../../../../src/core/rag/runtimes/llamacpp.ts";
import type { CatalogEntry, MachineProfile, ResolvedModel } from "../../../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "Intel Core Ultra 9 285K", threads: 24 },
  gpus: [
    {
      name: "NVIDIA GeForce RTX 5080",
      vendor: "nvidia",
      driver: "591.44",
      vramTotalMB: 16303,
      vramUsedMB: 2490,
      source: "nvidia-smi",
    },
  ],
  drives: [{ root: "D:\\", freeMB: 500000, totalMB: 1900000 }],
  loaded: [],
};

const GGUF = Buffer.from("GGUF fake model bytes");
const ONNX = Buffer.from("onnx bytes");
const REV = "0123456789abcdef0123456789abcdef01234567";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function entries(): CatalogEntry[] {
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
    size: { downloadMB: 1, ramMB: 10, vramMB: 10 },
    devices: ["gpu" as const, "cpu" as const],
    tier: "light" as const,
  };
  return [
    {
      ...base,
      id: "tiny-gguf",
      label: "Tiny GGUF",
      runtimes: ["llamacpp"],
      source: {
        hf: { repo: "acme/Tiny-GGUF", revision: REV, path: "tiny.gguf" },
        file: { sha256: sha(GGUF), size: GGUF.length },
      },
    },
    {
      ...base,
      id: "tiny-onnx",
      label: "Tiny ONNX",
      runtimes: ["transformers"],
      dtypeByDevice: { cpu: "q8" },
      source: {
        hf: {
          repo: "acme/tiny-onnx",
          revision: REV,
          files: [
            { path: "config.json", sha256: sha(ONNX), size: ONNX.length },
            { path: "tokenizer.json", sha256: sha(ONNX), size: ONNX.length },
            { path: "onnx/model_quantized.onnx", sha256: sha(ONNX), size: ONNX.length },
          ],
        },
      },
    },
  ];
}

const saved = { ...installDeps };
const savedDeps = { ...modelsDeps };
let probed: ResolvedModel[] = [];
let dir: string;

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-mcmd-"));
  writeRegistry({ ...readRegistry(), catalog: entries() });
  pinMachineProfile(devPc);
  probed = [];
  installDeps.probe = async (m) => {
    probed.push(m);
    return { dims: 8, maxTokens: 512 };
  };
});
afterEach(() => {
  Object.assign(installDeps, saved);
  Object.assign(modelsDeps, savedDeps);
  pinMachineProfile(null);
});

function ggufAt(name = "tiny.gguf", body = GGUF): string {
  const f = join(dir, name);
  writeFileSync(f, body);
  return f;
}

function onnxFolder(): string {
  const d = join(dir, "tiny-onnx");
  mkdirSync(join(d, "onnx"), { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "onnx/model_quantized.onnx"]) writeFileSync(join(d, f), ONNX);
  return d;
}

describe("models.add (path A)", () => {
  it("a .gguf file: recognised by size and SHA-256, probed, registered in place", async () => {
    const f = ggufAt();
    const r = await invoke("models.add", { path: f }, { project: null });
    expect(r).toEqual({ model: "tiny-gguf", via: "path", path: f, dims: 8, state: "verified" });
    expect(probed[0]).toMatchObject({ runtime: "llamacpp", device: "gpu", install: { path: f } });
    expect(readRegistry().installs).toEqual([
      expect.objectContaining({
        model: "tiny-gguf",
        via: "path",
        runtime: "llamacpp",
        path: f,
        status: "verified",
        sha256: sha(GGUF),
      }),
    ]);
    expect(existsSync(f)).toBe(true);
  });

  it("refuses a .gguf whose bytes differ from the catalog's", async () => {
    const f = ggufAt("bad.gguf", Buffer.from("GGUF fake model bytez"));
    await expect(invoke("models.add", { path: f }, { project: null })).rejects.toThrow(/does not match Tiny GGUF/);
    await expect(
      invoke("models.add", { path: ggufAt("odd.gguf", Buffer.from("x")) }, { project: null }),
    ).rejects.toThrow(/not a file of the catalog/);
  });

  it("a Hugging Face folder: matched by its files; copy goes into the models folder", async () => {
    const d = onnxFolder();
    const r = (await invoke("models.add", { path: d }, { project: null })) as { model: string; path: string };
    expect(r).toMatchObject({ model: "tiny-onnx", path: d });
    expect(probed[0]).toMatchObject({ runtime: "transformers", device: "cpu", dtype: "q8" });
    await expect(invoke("models.add", { path: d, copy: true }, { project: null })).rejects.toThrow(
      /Choose where models/,
    );
    writeRegistry({ ...readRegistry(), dir: join(dir, "models") });
    const c = (await invoke("models.add", { path: d, copy: true }, { project: null })) as { path: string };
    expect(c.path).toBe(join(dir, "models", "acme", "tiny-onnx"));
    expect(existsSync(join(c.path, "onnx", "model_quantized.onnx"))).toBe(true);
  });

  it("a llama.cpp folder registers the build", async () => {
    const d = join(dir, "llama");
    mkdirSync(d);
    writeFileSync(join(d, "llama-server.exe"), "");
    installDeps.findLlamaBuild = async (x) => ({
      exe: join(x, "llama-server.exe"),
      build: "b12032",
      backend: "cuda",
      via: "path",
    });
    const r = await invoke("models.add", { path: d }, { project: null });
    expect(r).toMatchObject({ model: "llama.cpp", path: join(d, "llama-server.exe") });
    expect(readRegistry().llamacpp).toMatchObject({ build: "b12032", backend: "cuda", via: "path" });
  });

  it("a failed probe still registers, as installed, with a warning", async () => {
    installDeps.probe = async () => {
      throw new Error("llama.cpp is not built yet.");
    };
    const logs: string[] = [];
    const r = (await invoke("models.add", { path: ggufAt() }, { project: null, onLog: (_l, m) => logs.push(m) })) as {
      state: string;
    };
    expect(r.state).toBe("installed");
    expect(logs.join()).toMatch(/not verified: llama.cpp is not built yet/);
  });
});

describe("models.verify, models.remove, models.list", () => {
  it("verify probes and marks verified; a changed file is broken", async () => {
    const f = ggufAt();
    writeRegistry({
      ...readRegistry(),
      installs: [{ model: "tiny-gguf", via: "path", runtime: "llamacpp", path: f, status: "installed" }],
    });
    const ok = (await invoke("models.verify", { model: "tiny-gguf" }, { project: null })) as {
      ok: boolean;
      dims: number;
    };
    expect(ok).toMatchObject({ ok: true, dims: 8 });
    expect(readRegistry().installs[0]).toMatchObject({ status: "verified", dims: 8 });
    writeFileSync(f, Buffer.from("GGUF fake model bytez"));
    const bad = (await invoke("models.verify", { model: "tiny-gguf" }, { project: null })) as {
      ok: boolean;
      message: string;
    };
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/missing or changed/);
    expect(readRegistry().installs[0].status).toBe("broken");
    const none = (await invoke("models.verify", { model: "tiny-onnx" }, { project: null })) as {
      ok: boolean;
      message: string;
    };
    expect(none).toMatchObject({ ok: false, message: "Tiny ONNX is not installed on this PC." });
  });

  it("remove: a download deletes its files, a path only unregisters", async () => {
    const dl = join(dir, "dl");
    mkdirSync(dl);
    writeFileSync(join(dl, "tiny.gguf"), GGUF);
    const own = ggufAt();
    writeRegistry({
      ...readRegistry(),
      installs: [
        { model: "tiny-gguf", via: "download", runtime: "llamacpp", path: join(dl, "tiny.gguf"), status: "installed" },
        { model: "tiny-onnx", via: "path", runtime: "transformers", path: own, status: "installed" },
      ],
    });
    expect(await invoke("models.remove", { model: "tiny-gguf" }, { project: null })).toMatchObject({
      removed: "files",
    });
    expect(existsSync(join(dl, "tiny.gguf"))).toBe(false);
    expect(await invoke("models.remove", { model: "tiny-onnx" }, { project: null })).toMatchObject({
      removed: "registration",
    });
    expect(existsSync(own)).toBe(true);
    expect(readRegistry().installs).toEqual([]);
    await expect(invoke("models.remove", { model: "tiny-gguf" }, { project: null })).rejects.toThrow(/not registered/);
  });

  it("list: where, how, state, used by which projects; a missing file is broken", async () => {
    const f = ggufAt();
    writeRegistry({
      ...readRegistry(),
      installs: [
        { model: "tiny-gguf", via: "path", runtime: "llamacpp", path: f, status: "verified" },
        { model: "tiny-onnx", via: "download", runtime: "transformers", path: join(dir, "gone"), status: "installed" },
      ],
    });
    writeSettings({ ...readSettings(), rag: { byProject: { "d:\\p": { embedding: "tiny-gguf", reranker: null } } } });
    const rows = (await invoke("models.list", {}, { project: null })) as {
      model: string;
      via: string;
      state: string;
      usedBy: string[];
    }[];
    const by = Object.fromEntries(rows.map((r) => [r.model, r]));
    expect(by["tiny-gguf"]).toMatchObject({ via: "path", state: "active", usedBy: ["d:\\p"], where: f });
    expect(by["tiny-onnx"]).toMatchObject({ state: "broken" });
  });
});

describe("catalog, hardware, fit, pullRuntime", () => {
  it("catalog: every entry with its state and its fit here", async () => {
    const rows = (await invoke("models.catalog", { kind: "embedding" }, { project: null })) as {
      id: string;
      state: string;
      fit: { verdict: string };
    }[];
    expect(rows.every((r) => r.fit.verdict)).toBe(true);
    expect(rows.find((r) => r.id === "qwen3-embedding-8b-q8")?.fit.verdict).toBe("fits");
    expect(rows.find((r) => r.id === "tiny-gguf")?.state).toBe("available");
  });

  it("hardware returns the profile; fit takes one model or a pair", async () => {
    expect(await invoke("models.hardware", {}, { project: null })).toEqual(devPc);
    const f = (await invoke(
      "models.fit",
      { embedding: "qwen3-embedding-8b-q8", reranker: "qwen3-reranker-4b-q8" },
      { project: null },
    )) as {
      verdict: string;
    };
    expect(f.verdict).toBe("tight");
    await expect(invoke("models.fit", {}, { project: null })).rejects.toThrow(/Name a model/);
  });

  it("pullRuntime: needs the folder, then registers the build it downloaded", async () => {
    await expect(invoke("models.pullRuntime", {}, { project: null, wait: true })).rejects.toThrow(
      /Choose where models/,
    );
    writeRegistry({ ...readRegistry(), dir });
    const asked: string[] = [];
    modelsDeps.llama = async () =>
      ({
        chooseBackend: () => "cuda",
        pullLlamaBuild: async (backend: string, d: string) => {
          asked.push(`${backend} ${d}`);
          return { exe: join(d, "b12032-cuda", "llama-server.exe"), build: "b12032", backend: "cuda", via: "download" };
        },
      }) as unknown as typeof import("../../../../src/core/rag/runtimes/llamacpp.ts");
    const r = await invoke("models.pullRuntime", {}, { project: null, wait: true });
    expect(r).toEqual({
      exe: join(dir, "runtimes", "b12032-cuda", "llama-server.exe"),
      build: "b12032",
      backend: "cuda",
    });
    expect(asked).toEqual([`cuda ${join(dir, "runtimes")}`]);
    expect(readRegistry().llamacpp).toMatchObject({ via: "download", backend: "cuda" });
  });
});

describe("models.verify can be cancelled while llama-server loads (#9)", () => {
  const savedIo = { ...serverIo };
  const savedHttp = env.http;
  afterEach(async () => {
    await stopAllServers();
    Object.assign(serverIo, savedIo);
    env.http = savedHttp;
    llamacppConfig.build = null;
  });

  it("the cancel stops the load, kills the process and leaves the registry as it was", async () => {
    const f = ggufAt();
    const exe = join(dir, "llama-server.exe");
    writeFileSync(exe, "");
    llamacppConfig.build = { exe, build: "b12032", backend: "cuda", via: "path" };
    writeRegistry({
      ...readRegistry(),
      installs: [{ model: "tiny-gguf", via: "path", runtime: "llamacpp", path: f, status: "installed" }],
    });
    const before = JSON.stringify(readRegistry());
    installDeps.probe = saved.probe;
    const killed: number[] = [];
    serverIo.spawn = () => ({ pid: 4242, onOutput: () => {}, exited: new Promise(() => {}) });
    serverIo.freePort = async () => 52000;
    serverIo.kill = async (pid) => {
      killed.push(pid);
    };
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const ctrl = new AbortController();
    let health = 0;
    env.http = async () => {
      if (++health === 3) ctrl.abort();
      return { status: 503, headers: {}, text: "{}" };
    };
    await expect(
      invoke("models.verify", { model: "tiny-gguf" }, { project: null, signal: ctrl.signal }),
    ).rejects.toThrow(/cancelled/);
    await new Promise((r) => setTimeout(r, 20));
    expect(killed).toEqual([4242]);
    expect(JSON.stringify(readRegistry())).toBe(before);
  });
});
