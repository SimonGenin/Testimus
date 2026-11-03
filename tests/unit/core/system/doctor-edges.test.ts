import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const fsCtl = vi.hoisted(() => ({ statfsFails: false }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    statfsSync: (...a: Parameters<typeof real.statfsSync>) => {
      if (fsCtl.statfsFails) throw new Error("statfs refused");
      return real.statfsSync(...a);
    },
  };
});

import { env } from "../../../../src/core/env.ts";
import {
  claudeLoginCheck,
  claudeVersionCheck,
  jiraCheck,
  onnxCheck,
  sqliteCheck,
  xrayCheck,
} from "../../../../src/core/lib/doctor.ts";
import { type ModelDeps, modelDeps, modelRows } from "../../../../src/core/lib/doctor-models.ts";
import { diskCheck } from "../../../../src/core/lib/doctor-row.ts";
import { catalogEntry, registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { pinMachineProfile } from "../../../../src/core/lib/models-hardware.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { DEFAULT_PROJECT, readSettings, writeProject, writeSettings } from "../../../../src/core/lib/project.ts";
import type {
  CatalogEntry,
  DoctorCheck,
  MachineProfile,
  ResolvedModel,
  RuntimeId,
} from "../../../../src/core/types.ts";

const saved = { http: env.http, spawn: env.spawnClaude };

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};

const deps = (over: Partial<ModelDeps> = {}): ModelDeps => ({
  machine: async () => devPc,
  active: async () => ({ embedding: null, reranker: null, wanted: [] }),
  space: async () => null,
  ...over,
});

const resolvedAs = (id: string, runtime: RuntimeId, path?: string): ResolvedModel => ({
  entry: catalogEntry(id) as CatalogEntry,
  runtime,
  device: "cpu",
  queryTask: "t",
  install: { model: id, via: "path", runtime, ...(path ? { path } : {}), status: "installed" },
});

const by = (rows: DoctorCheck[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
const spawnAnswer = (code: number, stdout: string, stderr = "") => {
  env.spawnClaude = async () => ({ code, stdout, stderr });
};

const atl = () => join(env.homeDir(), ".atlassian");
const writeJira = (baseUrl = "https://acme.atlassian.net") => {
  mkdirSync(atl(), { recursive: true });
  writeFileSync(join(atl(), "credentials.json"), JSON.stringify({ baseUrl, email: "a@b.c", token: "t" }));
};
const writeXray = () => {
  mkdirSync(atl(), { recursive: true });
  writeFileSync(join(atl(), "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "s" }));
};

beforeEach(() => {
  rmSync(atl(), { recursive: true, force: true });
  rmSync(registryFile(), { force: true });
  pinMachineProfile(devPc);
});

afterEach(() => {
  env.http = saved.http;
  env.spawnClaude = saved.spawn;
  pinMachineProfile(null);
  fsCtl.statfsFails = false;
  vi.doUnmock("sqlite-vec");
  vi.doUnmock("onnxruntime-node");
  vi.unstubAllEnvs();
});

describe("runtime checks", () => {
  it("the index engine fails when sqlite-vec cannot load", async () => {
    vi.doMock("sqlite-vec", () => ({
      load: () => {
        throw new Error("no extension");
      },
    }));
    expect(await sqliteCheck()).toMatchObject({ state: "fail", detail: "no extension" });
  });

  it("onnxruntime: loaded without a version, or failing with its cause", async () => {
    vi.doMock("onnxruntime-node", () => ({ env: {} }));
    expect(await onnxCheck()).toMatchObject({ state: "ok", detail: "onnxruntime loaded" });
    vi.doMock("onnxruntime-node", () => {
      throw Object.assign(new Error("dll missing"), { cause: { code: "ERR_DLOPEN_FAILED" } });
    });
    const r = await onnxCheck();
    expect(r.state).toBe("fail");
    expect(r.detail).toContain("dll missing");
  });

  it("onnxruntime: the fix names what this system needs", async () => {
    const { platform, arch } = process;
    vi.doMock("onnxruntime-node", () => {
      throw new Error("Cannot find module");
    });
    const on = async (p: string, a: string) => {
      Object.defineProperty(process, "platform", { value: p, configurable: true });
      Object.defineProperty(process, "arch", { value: a, configurable: true });
      return (await onnxCheck()).fix;
    };
    try {
      expect(await on("darwin", "x64")).toContain("onnxruntime-node-darwin-x64");
      expect(await on("win32", "x64")).toContain("Visual C++");
      expect(await on("darwin", "arm64")).toContain("darwin arm64");
    } finally {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
      Object.defineProperty(process, "arch", { value: arch, configurable: true });
    }
  });
});

describe("claude checks", () => {
  it("the version check fails when the spawn throws", async () => {
    env.spawnClaude = async () => {
      throw Object.assign(new Error("spawn failed"), { cause: { message: "ENOENT" } });
    };
    expect(await claudeVersionCheck(10)).toMatchObject({
      state: "fail",
      detail: expect.stringMatching(/(^|[\\/])claude(\.exe|\.cmd)?: spawn failed \(ENOENT\)$/),
    });
  });

  it("sign-in: ok, a plan limit, an unreadable answer, a bare exit code, a throw", async () => {
    spawnAnswer(0, JSON.stringify({ is_error: false, result: "ok" }));
    expect((await claudeLoginCheck(10)).state).toBe("ok");
    spawnAnswer(1, JSON.stringify({ is_error: true, result: "Usage limit reached" }));
    expect(await claudeLoginCheck(10)).toMatchObject({ state: "warn", fix: expect.stringMatching(/limit/) });
    spawnAnswer(1, "not json", "boom");
    expect(await claudeLoginCheck(10)).toMatchObject({ state: "fail", detail: "boom" });
    spawnAnswer(2, "", "");
    expect(await claudeLoginCheck(10)).toMatchObject({ state: "fail", detail: "claude -p exited with 2" });
    env.spawnClaude = async () => {
      throw "plain";
    };
    expect(await claudeLoginCheck(10)).toMatchObject({ state: "fail", detail: "plain" });
  });
});

describe("jira and xray checks", () => {
  it("jira: unreadable credentials, no display name, 403, 500, unreachable", async () => {
    mkdirSync(atl(), { recursive: true });
    writeFileSync(join(atl(), "credentials.json"), "{nope");
    expect(await jiraCheck()).toMatchObject({ state: "fail", fix: expect.stringMatching(/system setCredentials/) });
    writeJira();
    env.http = async () => ({ status: 200, headers: {}, text: "{}" });
    expect(await jiraCheck()).toMatchObject({ state: "ok", detail: "a@b.c on acme.atlassian.net" });
    env.http = async () => ({ status: 403, headers: {}, text: "" });
    expect((await jiraCheck()).detail).toMatch(/Jira 403/);
    env.http = async () => ({ status: 500, headers: {}, text: "" });
    expect(await jiraCheck()).toMatchObject({ detail: "Jira 500 on acme.atlassian.net" });
    env.http = async () => {
      throw new Error("ECONNRESET");
    };
    expect((await jiraCheck()).detail).toBe("acme.atlassian.net unreachable: ECONNRESET");
  });

  it("xray: missing credentials, an empty token, 403, unreachable", async () => {
    expect((await xrayCheck()).state).toBe("fail");
    writeXray();
    env.http = async () => ({ status: 200, headers: {} });
    expect((await xrayCheck()).detail).toBe("Xray authentication failed (200) on xray.cloud.getxray.app");
    env.http = async () => ({ status: 200, headers: {}, text: '"jwt"' });
    expect((await xrayCheck()).state).toBe("ok");
    env.http = async () => ({ status: 403, headers: {}, text: "" });
    expect((await xrayCheck()).detail).toMatch(/Xray 401/);
    env.http = async () => {
      throw new Error("ETIMEDOUT");
    };
    expect((await xrayCheck()).detail).toBe("xray.cloud.getxray.app unreachable: ETIMEDOUT");
  });
});

describe("model rows", () => {
  it("a model missing while downloads are off, or unknown to the catalog", async () => {
    writeSettings({ ...readSettings(), models: { allowRemote: false } });
    onTestFinished(() => writeSettings({ ...readSettings(), models: { allowRemote: true } }));
    const r = by(
      await modelRows(null, deps({ active: async () => ({ embedding: null, reranker: null, wanted: ["bge-m3-q8"] }) })),
    );
    expect(r["model.embedding"]).toMatchObject({
      state: "warn",
      detail: expect.stringMatching(/downloads are off$/),
      fix: expect.stringMatching(/team share/),
    });
  });

  it("a mock model is ok, a path-less install shows its runtime; a full fit is ok", async () => {
    const mock = resolvedAs("bge-m3-q8", "mock");
    const r = by(
      await modelRows(null, deps({ active: async () => ({ embedding: mock, reranker: null, wanted: [] }) })),
    );
    expect(r["model.embedding"]).toMatchObject({ state: "ok", detail: expect.stringMatching(/mock, cpu, mock/) });
    expect(r["model.fit"].state).toBe("ok");
    expect(r["model.offload"]).toMatchObject({ state: "ok" });
  });

  it("failures of the active models, the machine and the space become skips and warnings", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-cov-doctor-"));
    let r = by(
      await modelRows(
        project,
        deps({
          active: async () => {
            throw new Error("no");
          },
          machine: async () => {
            throw new Error("no");
          },
          space: async () => {
            throw new Error("index broken");
          },
        }),
      ),
    );
    expect(r["model.fit"]).toMatchObject({ state: "skip", detail: "machine profile unavailable" });
    expect(r["index.space"]).toMatchObject({ state: "warn", detail: "index broken" });
    r = by(
      await modelRows(
        project,
        deps({
          space: async () => {
            throw "raw";
          },
        }),
      ),
    );
    expect(r["model.fit"]).toMatchObject({ state: "skip", detail: "no model in use" });
    expect(r["index.space"].detail).toBe("raw");
  });

  it("the llama.cpp row shows only while a model in use runs on it: ok with its build, failed when the exe is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-cov-doctor-llama-"));
    const exe = join(dir, "llama-server.exe");
    writeFileSync(exe, "");
    writeRegistry({ ...readRegistry(), llamacpp: { exe, build: "b1", backend: "cpu", via: "path" } });
    expect(by(await modelRows(null, deps())).llamacpp).toBeUndefined();
    const llama = resolvedAs("qwen3-embedding-0.6b-q8", "llamacpp", dir);
    const uses = deps({ active: async () => ({ embedding: llama, reranker: null, wanted: [] }) });
    expect(by(await modelRows(null, uses)).llamacpp).toMatchObject({ state: "ok", detail: `b1 (cpu) at ${exe}` });
    rmSync(exe);
    expect(by(await modelRows(null, uses)).llamacpp).toMatchObject({
      state: "fail",
      detail: `${exe} is missing`,
      action: { command: "models.pullRuntime" },
    });
  });

  it("models on the system drive with room are a plain ok row; without SystemDrive the temp drive is used", async () => {
    vi.stubEnv("SystemDrive", "");
    writeRegistry({ ...readRegistry(), dir: tmpdir() });
    const r = by(await modelRows(null, deps()));
    expect(r["models.system"].label).toBe("Models on the system drive");
  });
});

describe("the real model deps", () => {
  it("without a project: the default models, nothing installed", async () => {
    const a = await modelDeps.active(null);
    expect(a.wanted).toEqual(["bge-m3-q8"]);
    expect(a.reranker).toBeNull();
    expect((await modelDeps.machine()).at).toBe(devPc.at);
  });

  it("with a project: what its choice wants, and the space of its index", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-cov-doctor-p-"));
    writeProject(project, {
      ...DEFAULT_PROJECT,
      rag: { reference: { embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" } },
    });
    const a = await modelDeps.active(project);
    expect(a.wanted).toEqual(expect.arrayContaining(["bge-m3-q8"]));
    expect(a.wanted.some((w) => w.startsWith("pack "))).toBe(false);
    expect(await modelDeps.space(project)).toEqual(expect.anything());
  });
});

describe("diskCheck", () => {
  it("fails far under the need, warns near it, and warns when the drive cannot be read", () => {
    expect(diskCheck("d", "D", tmpdir(), 1e9).state).toBe("fail");
    const free = Number(/^([\d.]+) GB/.exec(diskCheck("d", "D", tmpdir(), 0).detail)?.[1]);
    expect(diskCheck("d", "D", tmpdir(), free * 2).state).toBe("warn");
    fsCtl.statfsFails = true;
    expect(diskCheck("d", "D", tmpdir(), 1)).toEqual({ id: "d", label: "D", state: "warn", detail: "statfs refused" });
  });
});
