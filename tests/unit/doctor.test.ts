import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeSpawn, env, type HttpReq } from "../../src/core/env.ts";
import {
  diskCheck,
  hideAuth,
  type ModelDeps,
  modelRows,
  nodeCheck,
  proxyCheck,
  runDoctor,
} from "../../src/core/lib/doctor.ts";
import { catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import { readRegistry, writeRegistry } from "../../src/core/lib/models-registry.ts";
import { isComplete, modelDir, modelRoots, onnxFile } from "../../src/core/lib/models-store.ts";
import { DEFAULT_PROJECT, writeProject } from "../../src/core/lib/project.ts";
import type { CatalogEntry, DoctorCheck, MachineProfile, ResolvedModel, RuntimeId } from "../../src/core/types.ts";

const saved = { http: env.http, spawn: env.spawnClaude };
let http: HttpReq[] = [];
let spawns: ClaudeSpawn[] = [];

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};

const absent = {
  state: "absent" as const,
  host: "http://127.0.0.1:11434",
  storage: { dir: "x", freeMB: null, fromEnv: false },
  models: [],
  loaded: [],
  message: "Ollama is not installed. It is optional: every model also runs without it (llama.cpp or transformers.js).",
};

function fakeModels(over: Partial<ModelDeps> = {}): ModelDeps {
  return {
    machine: async () => devPc,
    ollama: async () => absent,
    active: async () => ({ embedding: null, reranker: null, wanted: ["bge-m3-q8"] }),
    space: async () => null,
    ...over,
  };
}

function resolvedAs(id: string, runtime: RuntimeId, status: "installed" | "verified"): ResolvedModel {
  const entry = catalogEntry(id) as CatalogEntry;
  return {
    entry,
    runtime,
    device: "gpu",
    queryTask: "t",
    install: { model: id, via: "path", runtime, path: "D:\\m", status },
  };
}

function writeCreds() {
  const atl = join(env.homeDir(), ".atlassian");
  mkdirSync(atl, { recursive: true });
  writeFileSync(
    join(atl, "credentials.json"),
    JSON.stringify({ baseUrl: "https://acme.atlassian.net/wiki", email: "a@b.c", token: "t" }),
  );
  writeFileSync(join(atl, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "s" }));
}

function fakeModel(root: string, hfId: string, onnx = "model_quantized.onnx") {
  const dir = modelDir(root, hfId);
  mkdirSync(join(dir, "onnx"), { recursive: true });
  writeFileSync(join(dir, "config.json"), "{}");
  writeFileSync(join(dir, "tokenizer.json"), "{}");
  writeFileSync(join(dir, "onnx", onnx), "");
  return dir;
}

beforeEach(() => {
  rmSync(join(env.homeDir(), ".atlassian"), { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  rmSync(registryFile(), { force: true });
  pinMachineProfile(devPc);
  http = [];
  spawns = [];
  env.http = async (req) => {
    http.push(req);
    if (req.url.endsWith("/rest/api/3/myself"))
      return { status: 200, headers: {}, text: JSON.stringify({ displayName: "Tess" }) };
    if (req.url.endsWith("/api/v2/authenticate")) return { status: 401, headers: {}, text: "nope" };
    throw new Error("unexpected");
  };
  env.spawnClaude = async (run) => {
    spawns.push(run);
    if (run.args[0] === "--version") return { code: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" };
    return {
      code: 1,
      stdout: JSON.stringify({ type: "result", is_error: true, result: "Invalid API key · Please run /login" }),
      stderr: "",
    };
  };
});

afterEach(() => {
  env.http = saved.http;
  env.spawnClaude = saved.spawn;
  pinMachineProfile(null);
});

describe("doctor", () => {
  it("gives one row per check, with a fix on every failing row", async () => {
    writeCreds();
    const project = mkdtempSync(join(tmpdir(), "testimus-doc-"));
    writeProject(project, { ...DEFAULT_PROJECT, rag: { embedding: "bge-m3", reranker: "rr" } });
    const rows = await runDoctor({ project, claude: true, models: fakeModels(), timeoutMs: 2000 });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows.map((r) => r.id)).toEqual([
      "node",
      "sqlite",
      "onnx",
      "face",
      "claude",
      "claudeLogin",
      "jira",
      "xray",
      "models.dir",
      "model.embedding",
      "model.reranker",
      "model.fit",
      "model.offload",
      "index.space",
      "ollama",
      "llamacpp",
      "disk.index",
      "proxy",
    ]);
    expect(by.node.state).toBe("ok");
    expect(by.sqlite.state).toBe("ok");
    expect(by.sqlite.detail).toMatch(/sqlite-vec/);
    expect(by.onnx.state).toBe("ok");
    expect(by.face).toMatchObject({ state: "ok", detail: "browser" });
    expect(by.claude).toMatchObject({ state: "ok", detail: "claude 2.1.300" });
    expect(by.claudeLogin.state).toBe("fail");
    expect(by.claudeLogin.detail).toMatch(/login/);
    expect(by.jira).toMatchObject({ state: "ok", detail: "Tess on acme.atlassian.net" });
    expect(by.xray.state).toBe("fail");
    expect(by.xray.detail).toMatch(/xray_credentials.json/);
    expect(by["model.embedding"].state).toBe("warn");
    expect(by["model.embedding"].fix).toMatch(/models pull bge-m3-q8/);
    expect(by["model.reranker"].state).toBe("skip");
    expect(by.ollama).toMatchObject({ state: "ok", detail: absent.message });
    expect(by["disk.index"].state).not.toBe("skip");
    for (const r of rows) if (r.state === "fail" || r.state === "warn") expect(r.fix, r.id).toBeTruthy();
    for (const r of rows) if (r.state === "ok") expect(r.fix, r.id).toBeUndefined();
    expect(http.map((h) => `${h.method} ${h.url}`).sort()).toEqual([
      "GET https://acme.atlassian.net/rest/api/3/myself",
      "POST https://xray.cloud.getxray.app/api/v2/authenticate",
    ]);
    expect(spawns.map((s) => s.args[0]).sort()).toEqual(["--version", "-p"]);
    expect(spawns.map((s) => s.stdin).join(" ")).not.toMatch(/token|secret/i);
  });

  it("skips the sign-in run unless asked, and fails Jira/Xray rows that have no files", async () => {
    const rows = await runDoctor({ project: null, claude: false, models: fakeModels(), timeoutMs: 2000 });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.claudeLogin.state).toBe("skip");
    expect(spawns.map((s) => s.args[0])).toEqual(["--version"]);
    expect(by.jira.state).toBe("fail");
    expect(by.jira.fix).toMatch(/system setup/);
    expect(by.xray.state).toBe("fail");
    expect(by["disk.index"].state).toBe("skip");
    expect(by["index.space"].state).toBe("skip");
    expect(by["model.reranker"].state).toBe("skip");
    expect(http).toEqual([]);
  });

  it("fails the claude row when the CLI is missing", async () => {
    env.spawnClaude = async () => ({ code: 1, stdout: "", stderr: "'claude' is not recognized" });
    const rows = await runDoctor({ project: null, claude: false, models: fakeModels(), timeoutMs: 2000 });
    const claude = rows.find((r) => r.id === "claude") as DoctorCheck;
    expect(claude.state).toBe("fail");
    expect(claude.fix).toMatch(/install\.ps1/);
  });

  it("runs as system.doctor without a project; Ollama not installed is no error", async () => {
    const r = (await invoke("system.doctor", {}, { project: null })) as { ok: boolean; checks: DoctorCheck[] };
    expect(r.checks.map((c) => c.id)).toContain("models.dir");
    expect(r.checks.find((c) => c.id === "ollama")).toMatchObject({ state: "ok" });
    expect(r.checks.find((c) => c.id === "face")).toMatchObject({ state: "ok" });
    expect(r.ok).toBe(false);
  });

  it("the face row says desktop when the shell says so", async () => {
    const prev = process.env.TESTIMUS_SHELL;
    process.env.TESTIMUS_SHELL = "desktop/0.2.0";
    try {
      const rows = await runDoctor({ project: null, claude: false, models: fakeModels(), timeoutMs: 2000 });
      expect(rows.find((r) => r.id === "face")).toMatchObject({ state: "ok", detail: "desktop 0.2.0" });
    } finally {
      if (prev === undefined) delete process.env.TESTIMUS_SHELL;
      else process.env.TESTIMUS_SHELL = prev;
    }
  });
});

describe("doctor — models (§7.11)", () => {
  const by = (rows: DoctorCheck[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

  it("models folder: not chosen is a warning with the command; chosen shows its free space", async () => {
    let r = by(await modelRows(null, fakeModels()));
    expect(r["models.dir"]).toMatchObject({ state: "warn", fix: expect.stringMatching(/models setDir/) });
    writeRegistry({ ...readRegistry(), dir: tmpdir() });
    r = by(await modelRows(null, fakeModels()));
    expect(r["models.dir"].state).toBe("ok");
    expect(r["models.dir"].detail).toMatch(/GB free/);
  });

  it("a model on the system drive gets its own row (warning under 10 GB free)", async () => {
    const prev = process.env.SystemDrive;
    process.env.SystemDrive = tmpdir().slice(0, 2);
    writeRegistry({
      ...readRegistry(),
      installs: [
        { model: "bge-m3-q8", via: "path", runtime: "transformers", path: join(tmpdir(), "m"), status: "installed" },
      ],
    });
    try {
      const sys = by(await modelRows(null, fakeModels()))["models.system"];
      expect(sys.label).toBe("Models on the system drive");
      if (sys.state !== "ok") expect(sys.fix).toMatch(/--move/);
    } finally {
      if (prev === undefined) delete process.env.SystemDrive;
      else process.env.SystemDrive = prev;
    }
  });

  it("active embedding installed and verified; not verified is a warning; llama.cpp needed but missing fails", async () => {
    const verified = resolvedAs("qwen3-embedding-4b-q8", "llamacpp", "verified");
    let r = by(
      await modelRows(null, fakeModels({ active: async () => ({ embedding: verified, reranker: null, wanted: [] }) })),
    );
    expect(r["model.embedding"].state).toBe("ok");
    expect(r.llamacpp).toMatchObject({ state: "fail", fix: expect.stringMatching(/pullRuntime/) });
    const notYet = resolvedAs("bge-m3-q8", "transformers", "installed");
    r = by(
      await modelRows(null, fakeModels({ active: async () => ({ embedding: notYet, reranker: null, wanted: [] }) })),
    );
    expect(r["model.embedding"]).toMatchObject({ state: "warn", fix: "testimus models verify bge-m3-q8" });
    expect(r.llamacpp.state).toBe("skip");
  });

  it("fit of embedding + reranker together; RAM too small fails", async () => {
    const wanted = ["qwen3-embedding-8b-q8", "qwen3-reranker-4b-q8"];
    let r = by(
      await modelRows(null, fakeModels({ active: async () => ({ embedding: null, reranker: null, wanted }) })),
    );
    expect(r["model.fit"].state).toBe("warn");
    expect(r["model.fit"].detail).toMatch(/Tight/);
    r = by(
      await modelRows(
        null,
        fakeModels({
          machine: async () => ({ ...devPc, gpus: [], ramTotalMB: 4000, ramFreeMB: 2000 }),
          active: async () => ({ embedding: null, reranker: null, wanted }),
        }),
      ),
    );
    expect(r["model.fit"].state).toBe("fail");
  });

  it("a model Ollama holds partly on the processor is a warning", async () => {
    const machine = async () => ({
      ...devPc,
      loaded: [{ name: "qwen3-embedding:8b-q8_0", sizeMB: 9300, vramMB: 6000, runtime: "ollama" as const }],
    });
    const r = by(
      await modelRows(
        null,
        fakeModels({
          machine,
          active: async () => ({ embedding: null, reranker: null, wanted: ["qwen3-embedding-8b-q8"] }),
        }),
      ),
    );
    expect(r["model.offload"].state).toBe("warn");
    expect(r["model.offload"].detail).toMatch(/partly on the processor: qwen3-embedding:8b-q8_0/);
  });

  it("Ollama: absent is fine unless a model in use is served by it", async () => {
    const viaOllama = resolvedAs("qwen3-embedding-4b-q4", "ollama", "verified");
    const r = by(
      await modelRows(null, fakeModels({ active: async () => ({ embedding: viaOllama, reranker: null, wanted: [] }) })),
    );
    expect(r.ollama.state).toBe("fail");
    expect(r.ollama.fix).toMatch(/every pack runs without it/);
    expect(by(await modelRows(null, fakeModels())).ollama).toMatchObject({ state: "ok", detail: absent.message });
  });

  it("space of the active model: complete, or what to do", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-doc-sp-"));
    let r = by(await modelRows(project, fakeModels()));
    expect(r["index.space"].state).toBe("ok");
    r = by(await modelRows(project, fakeModels({ space: async () => "No vectors for bge-m3-q8 yet: run rag index." })));
    expect(r["index.space"]).toMatchObject({ state: "warn", fix: "testimus rag index" });
  });
});

describe("doctor rows", () => {
  it("node version", () => {
    expect(nodeCheck("v26.1.0").state).toBe("ok");
    expect(nodeCheck("v22.0.0").state).toBe("fail");
  });

  it("proxy: none, used, ignored, credentials hidden", () => {
    expect(proxyCheck({}).detail).toMatch(/none/);
    expect(proxyCheck({ HTTPS_PROXY: "http://proxy:8080", NODE_USE_ENV_PROXY: "1" }).state).toBe("ok");
    const off = proxyCheck({ HTTPS_PROXY: "http://user:pw@proxy:8080" });
    expect(off.state).toBe("warn");
    expect(off.detail).not.toMatch(/pw/);
    expect(off.fix).toMatch(/testimus.cmd/);
    expect(hideAuth("http://u:p@h:1")).toBe("http://***@h:1");
  });

  it("proxy: fails when HTTP_PROXY would also take the loopback calls, with the fix", () => {
    const on = { HTTP_PROXY: "http://proxy:8080", HTTPS_PROXY: "http://proxy:8080", NODE_USE_ENV_PROXY: "1" };
    const bad = proxyCheck(on);
    expect(bad.state).toBe("fail");
    expect(bad.detail).toMatch(/localhost, 127\.0\.0\.1, ::1/);
    expect(bad.fix).toMatch(/NO_PROXY/);
    expect(bad.fix).toMatch(/testimus\.cmd/);
    const partial = proxyCheck({ ...on, NO_PROXY: "corp.example,127.0.0.1" });
    expect(partial.state).toBe("fail");
    expect(partial.detail).toMatch(/localhost, ::1/);
    expect(proxyCheck({ ...on, NO_PROXY: "corp.example,localhost,127.0.0.1,::1" }).state).toBe("ok");
    expect(proxyCheck({ ...on, no_proxy: "localhost,127.0.0.1,[::1]" }).state).toBe("ok");
    expect(proxyCheck({ ...on, NO_PROXY: "*" }).state).toBe("ok");
    expect(proxyCheck({ HTTPS_PROXY: "http://proxy:8080", NODE_USE_ENV_PROXY: "1" }).state).toBe("ok");
    expect(proxyCheck({ HTTP_PROXY: "http://proxy:8080" }).state).toBe("warn");
  });

  it("disk space walks up to an existing folder", () => {
    const r = diskCheck("disk.x", "Disk", join(tmpdir(), "does", "not", "exist"), 0.001);
    expect(r.state).toBe("ok");
    expect(diskCheck("disk.y", "Disk", tmpdir(), 1e9).state).toBe("fail");
  });
});

describe("models store", () => {
  it("looks in the chosen folder, TESTIMUS_MODELS, then LOCALAPPDATA, then the release", () => {
    const prev = process.env.TESTIMUS_MODELS;
    process.env.TESTIMUS_MODELS = "X:\\m";
    try {
      expect(modelRoots().map((r) => r.kind)).toEqual(["env", "user", "release"]);
      expect(modelRoots()[1].dir).toBe(join(env.localDir(), "models"));
      writeRegistry({ ...readRegistry(), dir: "D:\\chosen" });
      expect(modelRoots().map((r) => r.kind)).toEqual(["dir", "env", "user", "release"]);
      rmSync(registryFile(), { force: true });
    } finally {
      if (prev === undefined) delete process.env.TESTIMUS_MODELS;
      else process.env.TESTIMUS_MODELS = prev;
    }
    expect(modelRoots().map((r) => r.kind)).toEqual(["user", "release"]);
  });

  it("checks the onnx file of the profile's dtype", () => {
    const root = mkdtempSync(join(tmpdir(), "testimus-ms-"));
    const dir = fakeModel(root, "org/m", "model_quantized.onnx");
    expect(onnxFile("q8")).toBe("model_quantized.onnx");
    expect(onnxFile("fp32")).toBe("model.onnx");
    expect(isComplete(dir, "q8")).toBe(true);
    expect(isComplete(dir, "fp16")).toBe(false);
    expect(isComplete(dir)).toBe(true);
    expect(isComplete(join(root, "org", "none"))).toBe(false);
  });
});
