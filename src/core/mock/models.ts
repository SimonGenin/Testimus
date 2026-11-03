import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep } from "../../shared/run/work.ts";
import { env } from "../env.ts";
import { SHIPPED } from "../lib/models-catalog.ts";
import { downloadDeps, filesFor, hfUrl, installPath } from "../lib/models-download.ts";
import { installDeps } from "../lib/models-install.ts";
import { recordPerf } from "../lib/models-perf.ts";
import { writeRegistry } from "../lib/models-registry.ts";
import { readSettings, writeJson, writeSettings } from "../lib/project.ts";
import { activeChoice, setActiveChoice } from "../rag/activation.ts";
import { chooseBackend, LLAMA_ASSETS, LLAMA_BUILD, llamaIo } from "../rag/runtimes/llamacpp.ts";
import type {
  CatalogEntry,
  HfFile,
  Installation,
  LlamaBackend,
  LlamaRuntime,
  MachineProfile,
  PerfLine,
} from "../types.ts";
import { type MockMachine, mockMachine, mockMachineKind } from "./machine.ts";

export const MOCK_ADVICE = ["upgrade", "downgrade", "offload", "none"] as const;
export type MockAdvice = (typeof MOCK_ADVICE)[number];

export type MockModelsOptions = {
  machine: MockMachine;
  llamacpp: "found" | "absent";
  modelsDir: "set" | "unset";
  advice: MockAdvice;
  index: "vectors" | "bm25";
  downloadMs: number;
  probe?: "ok" | "fail";
};

const MB = 1024 * 1024;
const FILL = 0x5a;
const BIG = 4 * MB;

const pick = <T extends string>(raw: string | undefined, all: readonly T[], fallback: T): T =>
  (all as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

export function mockModelsOptions(e: NodeJS.ProcessEnv = process.env): MockModelsOptions {
  return {
    machine: mockMachineKind(e.TESTIMUS_MOCK_MACHINE),
    llamacpp: pick(e.TESTIMUS_MOCK_LLAMACPP, ["found", "absent"], "found"),
    modelsDir: pick(e.TESTIMUS_MOCK_MODELS_DIR, ["set", "unset"], "set"),
    advice: pick(e.TESTIMUS_MOCK_ADVICE, MOCK_ADVICE, "upgrade"),
    index: pick(e.TESTIMUS_MOCK_INDEX, ["vectors", "bm25"], "vectors"),
    downloadMs: Math.max(0, Number(e.TESTIMUS_MOCK_DOWNLOAD_MS) || 2500),
    probe: pick(e.TESTIMUS_MOCK_PROBE, ["ok", "fail"] as const, "ok"),
  };
}

// ponytail: real weights are gigabytes, so the mock catalog points every file at a few fake bytes whose SHA-256 is
// true — downloads, resume, checks and the registry then run the real code
export function fakeSize(real: number): number {
  if (real >= 64 * MB) return BIG;
  if (real >= MB) return MB / 2;
  return Math.min(real, 4096);
}

const shas = new Map<number, string>();
export function fakeSha(size: number): string {
  let s = shas.get(size);
  if (!s) {
    s = createHash("sha256").update(Buffer.alloc(size, FILL)).digest("hex");
    shas.set(size, s);
  }
  return s;
}

const fakeFile = (f: HfFile): HfFile => ({ path: f.path, size: fakeSize(f.size), sha256: fakeSha(fakeSize(f.size)) });

export function fakeCatalog(entries: CatalogEntry[] = SHIPPED.entries): CatalogEntry[] {
  return entries.map((e) => {
    const hf = e.source.hf;
    if (!hf) return e;
    const file = e.source.file
      ? { size: fakeSize(e.source.file.size), sha256: fakeSha(fakeSize(e.source.file.size)) }
      : undefined;
    return {
      ...e,
      source: {
        ...e.source,
        hf: { ...hf, ...(hf.files ? { files: hf.files.map(fakeFile) } : {}) },
        ...(file ? { file } : {}),
      },
    };
  });
}

const served = new Map<string, number>();
export const mockDownloads = { ms: 2500, fetched: [] as string[] };

function fakeStream(size: number, start: number, signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  const chunk = 256 * 1024;
  let at = start;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (signal?.aborted) {
        c.error(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      if (at >= size) {
        c.close();
        return;
      }
      const n = Math.min(chunk, size - at);
      try {
        await sleep((mockDownloads.ms * n) / BIG, signal ?? undefined);
      } catch {
        c.error(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      at += n;
      c.enqueue(new Uint8Array(n).fill(FILL));
    },
  });
}

export async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  const size = served.get(url);
  if (size === undefined) return new Response(`mock: no file at ${url}`, { status: 404 });
  mockDownloads.fetched.push(url);
  const range = /bytes=(\d+)-/.exec(String((init.headers as Record<string, string> | undefined)?.Range ?? ""));
  const start = range ? Math.min(Number(range[1]), size) : 0;
  return new Response(fakeStream(size, start, init.signal), {
    status: range ? 206 : 200,
    headers: { "content-length": String(size - start) },
  });
}

function writeFake(path: string, size: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(size, FILL));
}

function placeModel(root: string, entry: CatalogEntry, dtype?: string): string {
  const files = filesFor(entry, dtype);
  const base = join(root, ...(entry.source.hf?.repo.split("/") ?? []));
  for (const f of files) writeFake(join(base, ...f.path.split("/")), f.size);
  return installPath(root, entry);
}

async function fakePullLlama(
  backend: LlamaBackend,
  dir: string,
  onProgress: (p: { file: string; loaded: number; total: number }) => void,
  signal: AbortSignal,
): Promise<LlamaRuntime> {
  const target = join(dir, `${LLAMA_BUILD}-${backend}`);
  const cancelled = () => new Error(`Download of llama.cpp ${LLAMA_BUILD} (${backend}) cancelled.`);
  for (const a of LLAMA_ASSETS[backend]) {
    for (let i = 1; i <= 8; i++) {
      if (signal.aborted) throw cancelled();
      await sleep(mockDownloads.ms / 8, signal).catch(() => {
        throw cancelled();
      });
      onProgress({ file: a.name, loaded: Math.round((a.size * i) / 8), total: a.size });
    }
  }
  return placeLlama(target, backend, "download");
}

function placeLlama(target: string, backend: LlamaBackend, via: LlamaRuntime["via"]): LlamaRuntime {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "llama-server.exe"), "");
  if (backend !== "cpu") writeFileSync(join(target, `ggml-${backend}.dll`), "");
  writeJson(join(target, "testimus-build.json"), { build: LLAMA_BUILD, backend, assets: [] });
  return { exe: join(target, "llama-server.exe"), build: LLAMA_BUILD, backend, via };
}

type Seed = { at: number; op: PerfLine["op"]; model: string; device: string; ms: number; items: number } & Partial<
  Pick<PerfLine, "runtime" | "partialOffload" | "vramMB" | "peakRssMB">
>;

function perfSeed(advice: MockAdvice, now: number): Seed[] {
  if (advice === "none") return [];
  const out: Seed[] = [];
  const day = 86_400_000;
  const jitter = (i: number, lo: number, hi: number) => lo + (((i * 7919) % 101) / 100) * (hi - lo);
  if (advice === "upgrade") {
    const base = { model: "bge-m3-q8", device: "cpu", runtime: "transformers" as const };
    out.push({ ...base, at: now - 6 * day, op: "model.load", ms: 2300, items: 1, peakRssMB: 1240 });
    for (let i = 0; i < 12; i++)
      out.push({ ...base, at: now - 6 * day + i * 60_000, op: "embed.index", ms: jitter(i, 1400, 2100), items: 16 });
    for (let i = 0; i < 60; i++)
      out.push({ ...base, at: now - 5 * day + i * 3_600_000, op: "embed.query", ms: jitter(i, 32, 140), items: 1 });
    return out;
  }
  const emb = { model: "qwen3-embedding-4b-q4", device: "gpu", runtime: "llamacpp" as const };
  const rr = { model: "qwen3-reranker-0.6b-q8", device: "gpu", runtime: "llamacpp" as const };
  const slow = advice === "downgrade";
  const off = advice === "offload" ? { partialOffload: true } : {};
  out.push({ ...emb, at: now - 4 * day, op: "model.load", ms: 9400, items: 1, vramMB: 3500, ...off });
  out.push({ ...rr, at: now - 4 * day, op: "model.load", ms: 3100, items: 1, vramMB: 1350 });
  for (let i = 0; i < 12; i++)
    out.push({
      ...emb,
      at: now - 4 * day + i * 60_000,
      op: "embed.index",
      ms: jitter(i, 900, 1600),
      items: 16,
      ...off,
    });
  for (let i = 0; i < 30; i++) {
    const at = now - 3 * day + i * 3_600_000;
    out.push({ ...emb, at, op: "embed.query", ms: slow ? jitter(i, 700, 1500) : jitter(i, 60, 160), items: 1, ...off });
    out.push({ ...rr, at: at + 1, op: "rerank", ms: slow ? jitter(i, 300, 650) : jitter(i, 80, 180), items: 40 });
  }
  return out;
}

function seedPerf(advice: MockAdvice): void {
  const now = env.now().getTime();
  for (const s of perfSeed(advice, now)) recordPerf({ ...s, at: new Date(s.at).toISOString() } as PerfLine);
}

export function seedChoice(project: string, advice: MockAdvice): void {
  if (advice === "none" || activeChoice(project)) return;
  if (advice === "upgrade")
    setActiveChoice(project, { pack: "light", variant: { embedding: "bge-m3-q8", reranker: null } });
  else
    setActiveChoice(project, {
      pack: "balanced",
      variant: { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-0.6b-q8" },
    });
}

export type MockModels = { options: MockModelsOptions; machine: MachineProfile; dir: string | null; shared: string };

export async function setupModelsMock(
  root: string,
  project: string | null,
  o: MockModelsOptions = mockModelsOptions(),
): Promise<MockModels> {
  process.env.LOCALAPPDATA = join(root, "localappdata");
  delete process.env.TESTIMUS_MODELS;
  mockDownloads.ms = o.downloadMs;
  const machine = mockMachine(o.machine);
  if (!process.env.TESTIMUS_MACHINE) {
    const file = join(root, "machine.json");
    writeJson(file, machine);
    process.env.TESTIMUS_MACHINE = file;
  }

  const entries = fakeCatalog();
  const byId = new Map(entries.map((e) => [e.id, e]));
  served.clear();
  for (const e of entries) {
    const hf = e.source.hf;
    if (!hf) continue;
    const files = hf.path && e.source.file ? [{ path: hf.path, ...e.source.file }] : (hf.files ?? []);
    for (const f of files) served.set(hfUrl(hf.repo, hf.revision, f.path), f.size);
  }

  const dir = o.modelsDir === "set" ? join(root, "models") : null;
  const shared = join(root, "team-models");
  const installs: Installation[] = [];
  const at = env.now().toISOString();
  const put = (id: string, via: "path" | "download", where: string, verified: boolean) => {
    const e = byId.get(id);
    if (!e?.source.hf) return;
    const gguf = !e.runtimes.includes("transformers");
    const dtype = gguf ? undefined : e.dtypeByDevice?.cpu;
    installs.push({
      model: id,
      via,
      runtime: gguf ? "llamacpp" : "transformers",
      path: placeModel(where, e, dtype),
      revision: e.source.hf.revision,
      ...(dtype ? { dtype, device: "cpu" as const } : { device: "gpu" as const }),
      ...(gguf && e.source.file ? { sha256: e.source.file.sha256 } : {}),
      status: verified ? "verified" : "installed",
      ...(verified ? { verifiedAt: at, dims: e.dims } : {}),
    });
  };
  put("bge-m3-q8", "path", shared, true);
  put("qwen3-embedding-0.6b-onnx-q8", "path", shared, false);
  put("qwen3-embedding-8b-q4", "path", shared, false);
  if (dir) {
    put("bge-reranker-v2-m3-q8", "download", dir, true);
    put("qwen3-embedding-0.6b-q8", "download", dir, false);
    const half = byId.get("qwen3-embedding-4b-q8");
    if (half?.source.file) {
      const file = installPath(dir, half);
      writeFake(`${file}.part`, Math.floor(half.source.file.size / 2));
    }
  } else put("bge-reranker-v2-m3-q8", "path", shared, true);

  let llamacpp: LlamaRuntime | undefined;
  if (o.llamacpp === "found") {
    const backend = chooseBackend(machine);
    llamacpp = dir
      ? placeLlama(join(dir, "runtimes", `${LLAMA_BUILD}-${backend}`), backend, "download")
      : placeLlama(join(root, "llama.cpp", `${LLAMA_BUILD}-bin-win-${backend}-x64`), backend, "path");
  }

  writeRegistry({
    ...(dir ? { dir } : {}),
    installs,
    ...(llamacpp ? { llamacpp } : {}),
    catalog: entries,
  });

  downloadDeps.fetch = fakeFetch;
  // ponytail: the fake bytes cannot load; a probe answers like a load on this machine would, journal line included
  installDeps.probe = async (m) => {
    if (o.probe === "fail") throw new Error("mock: the runtime cannot load this model here (TESTIMUS_MOCK_PROBE=fail)");
    recordPerf({ at: env.now().toISOString(), op: "model.load", model: m.entry.id, items: 1, ms: 900, loadMs: 900 });
    return { dims: m.entry.dims, maxTokens: m.entry.maxInputTokens };
  };
  llamaIo.download = async (url) => {
    throw new Error(`mock: no network (${url})`);
  };
  const { modelsDeps } = await import("../lib/models-use.ts");
  const real = modelsDeps.llama;
  modelsDeps.llama = async () => ({ ...(await real()), pullLlamaBuild: fakePullLlama });

  const s = readSettings();
  writeSettings({ ...s, models: { ...s.models, allowRemote: true } });
  if (project) seedChoice(project, o.advice);
  seedPerf(o.advice);
  return { options: o, machine, dir, shared };
}
