import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inflateRawSync } from "node:zlib";
import { UserError } from "../../command.ts";
import { registryFile } from "../../lib/models-catalog.ts";
import { freeMB } from "../../lib/models-download.ts";
import { addTokens, perfFields } from "../../lib/models-perf.ts";
import { readJson } from "../../lib/project.ts";
import { crc32 } from "../../lib/zip.ts";
import type { LlamaBackend, LlamaRuntime, MachineProfile, ModelsRegistry, ResolvedModel } from "../../types.ts";
import { instruction } from "../fingerprint.ts";
import { ensureServer, LLAMA_CTX, type LlamaServer, type ServerKind, serverPost } from "./llama-server.ts";
import type { Runtime } from "./types.ts";

export { stopAllServers } from "./llama-server.ts";

export const LLAMA_BUILD = "b12032";
export const LLAMA_CUDA = "13.4";
export const CUDA_MIN_DRIVER = 580;
export const LLAMA_BATCH = 16;
const RELEASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/`;
const MARKER = "testimus-build.json";
const MB = 1024 * 1024;

export type LlamaAsset = { name: string; sha256: string; size: number };

// ponytail: SHA-256 read from the GitHub API (`digest` of each asset of release b12032) on 2026-11-02 and pinned here
export const LLAMA_ASSETS: Record<LlamaBackend, LlamaAsset[]> = {
  cuda: [
    {
      name: `llama-${LLAMA_BUILD}-bin-win-cuda-${LLAMA_CUDA}-x64.zip`,
      sha256: "4b2d4c4678192fbadc443e2c406fef06356d1b064ae9ab79b9f67e4329903511",
      size: 165164493,
    },
    {
      name: `cudart-llama-bin-win-cuda-${LLAMA_CUDA}-x64.zip`,
      sha256: "738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668",
      size: 423535356,
    },
  ],
  vulkan: [
    {
      name: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`,
      sha256: "19a8bbf269fa683ae7bc04f886c9c2a93e0655c2606f37d2b60069bf9e8bcc32",
      size: 37523450,
    },
  ],
  cpu: [
    {
      name: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`,
      sha256: "5296f5d18bb7d422c7c26f4bb9bc796d9d4f41e1312a8c296cff475bdc60d0d4",
      size: 24582754,
    },
  ],
};

export function chooseBackend(machine: MachineProfile): LlamaBackend {
  const real = machine.gpus.filter((g) => !/basic (display|render)|remote display|virtual|hyper-v/i.test(g.name));
  const cudaReady = real.some(
    (g) => g.vendor === "nvidia" && g.driver !== undefined && Number.parseFloat(g.driver) >= CUDA_MIN_DRIVER,
  );
  if (cudaReady) return "cuda";
  return real.length ? "vulkan" : "cpu";
}

export function findLlamaBuild(dir: string): LlamaRuntime | null {
  const d = /\.exe$/i.test(dir) ? dirname(dir) : dir;
  const exe = join(d, "llama-server.exe");
  if (!existsSync(exe)) return null;
  const files = new Set(readdirSync(d).map((f) => f.toLowerCase()));
  const backend: LlamaBackend = files.has("ggml-cuda.dll") ? "cuda" : files.has("ggml-vulkan.dll") ? "vulkan" : "cpu";
  const marker = readJson<{ build?: string }>(join(d, MARKER), {});
  const build =
    marker.build ??
    basename(d)
      .match(/\bb\d{3,}/i)?.[0]
      ?.toLowerCase() ??
    "unknown";
  return { exe, build, backend, via: "path" };
}

export const llamaIo = {
  async download(
    url: string,
    file: string,
    onBytes: (loaded: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const res = await fetch(url, { signal, headers: { "user-agent": "testimus" } });
    if (!res.ok || !res.body) throw new UserError(`Download failed: HTTP ${res.status} ${url}`);
    const total = Number(res.headers.get("content-length") ?? 0);
    let loaded = 0;
    const counted = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    counted.on("data", (c: Buffer) => {
      loaded += c.length;
      onBytes(loaded, total);
    });
    await pipeline(counted, createWriteStream(file), { signal });
  },
};

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

function safeName(name: string): string {
  const n = normalize(name.replace(/\\/g, "/"));
  if (!n || n.startsWith("..") || /^[a-z]:/i.test(n) || n.startsWith(sep) || n.split(sep).includes(".."))
    throw new UserError(`Refused a zip entry outside the target folder: ${name}`);
  return n;
}

// ponytail: the zips hold DLLs of several hundred MB, so entries are read one at a time from the file, never the whole archive at once
export function extractZip(file: string, dest: string): string[] {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new UserError(`Not a zip file: ${basename(file)}`);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new UserError(`Zip64 is not supported: ${basename(file)}`);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const entries: { name: string; method: number; crc: number; csize: number; local: number }[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new UserError(`Corrupt zip: ${basename(file)}`);
      const nameLen = cd.readUInt16LE(p + 28);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      const csize = cd.readUInt32LE(p + 20);
      const local = cd.readUInt32LE(p + 42);
      if (csize === 0xffffffff || local === 0xffffffff)
        throw new UserError(`Zip64 is not supported: ${basename(file)}`);
      if (!name.endsWith("/"))
        entries.push({
          name: safeName(name).split(sep).join("/"),
          method: cd.readUInt16LE(p + 10),
          crc: cd.readUInt32LE(p + 16),
          csize,
          local,
        });
      p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
    }
    const tops = new Set(entries.map((e) => e.name.split("/")[0]));
    const strip = tops.size === 1 && entries.every((e) => e.name.includes("/")) ? `${[...tops][0]}/` : "";
    const out: string[] = [];
    for (const e of entries) {
      const rel = e.name.slice(strip.length);
      const head = Buffer.alloc(30);
      readSync(fd, head, 0, 30, e.local);
      const start = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const raw = Buffer.alloc(e.csize);
      readSync(fd, raw, 0, e.csize, start);
      const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw) : null;
      if (!data) throw new UserError(`Unsupported zip compression ${e.method} in ${basename(file)}`);
      if (crc32(data) !== e.crc) throw new UserError(`Corrupt zip entry ${e.name} in ${basename(file)}`);
      const target = join(dest, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      out.push(rel);
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

export async function pullLlamaBuild(
  backend: LlamaBackend,
  dir: string,
  onProgress: (p: { file: string; loaded: number; total: number }) => void,
  signal: AbortSignal,
): Promise<LlamaRuntime> {
  const target = join(dir, `${LLAMA_BUILD}-${backend}`);
  const assets = LLAMA_ASSETS[backend];
  const have = findLlamaBuild(target);
  const marker = readJson<{ build?: string; assets?: string[] }>(join(target, MARKER), {});
  if (have && marker.build === LLAMA_BUILD && assets.every((a) => marker.assets?.includes(a.sha256)))
    return { ...have, via: "download" };
  const needMB = Math.ceil((assets.reduce((n, a) => n + a.size, 0) * 3) / MB);
  const free = freeMB(dir);
  if (free !== null && free < needMB)
    throw new UserError(
      `Not enough free space for llama.cpp ${LLAMA_BUILD} (${backend}): ${needMB} MB needed, ${free} MB free on ${dir}.`,
    );
  const dl = join(target, ".download");
  mkdirSync(dl, { recursive: true });
  for (const a of assets) {
    const zip = join(dl, a.name);
    if (existsSync(zip) && statSync(zip).size === a.size && (await sha256File(zip)) === a.sha256) {
      onProgress({ file: a.name, loaded: a.size, total: a.size });
      continue;
    }
    const part = `${zip}.part`;
    rmSync(part, { force: true });
    try {
      await llamaIo.download(
        RELEASE_URL + a.name,
        part,
        (loaded, total) => onProgress({ file: a.name, loaded, total: total || a.size }),
        signal,
      );
    } catch (e) {
      rmSync(part, { force: true });
      if (signal.aborted) throw new UserError(`Download of llama.cpp ${LLAMA_BUILD} (${backend}) cancelled.`);
      throw e;
    }
    if (signal.aborted) {
      rmSync(part, { force: true });
      throw new UserError(`Download of llama.cpp ${LLAMA_BUILD} (${backend}) cancelled.`);
    }
    const got = await sha256File(part);
    if (got !== a.sha256) {
      rmSync(part, { force: true });
      throw new UserError(`${a.name} does not match its published SHA-256 (got ${got}): deleted.`);
    }
    renameSync(part, zip);
  }
  for (const a of assets) extractZip(join(dl, a.name), target);
  writeFileSync(
    join(target, MARKER),
    JSON.stringify({ build: LLAMA_BUILD, backend, assets: assets.map((a) => a.sha256) }, null, 2),
  );
  rmSync(dl, { recursive: true, force: true });
  const found = findLlamaBuild(target);
  if (!found) throw new UserError(`llama-server.exe is missing from the llama.cpp ${LLAMA_BUILD} (${backend}) zip.`);
  return { ...found, via: "download" };
}

export const llamacppConfig: { build: LlamaRuntime | null } = { build: null };

export function llamaBuild(): LlamaRuntime {
  const b = llamacppConfig.build ?? readJson<Partial<ModelsRegistry>>(registryFile(), {}).llamacpp;
  if (!b || !existsSync(b.exe))
    throw new UserError(
      "llama.cpp is not installed on this PC.",
      "Run: testimus models pullRuntime (or register a folder holding llama-server.exe).",
    );
  return b;
}

function serverFor(m: ResolvedModel, kind: ServerKind): Promise<LlamaServer> {
  const model = m.install.path;
  if (!model || !/\.gguf$/i.test(model) || !existsSync(model))
    throw new UserError(`${m.entry.label}: its GGUF file is missing (${model ?? "no path"}).`);
  const b = llamaBuild();
  const onGpu = b.backend !== "cpu";
  return ensureServer({
    exe: b.exe,
    model,
    kind,
    catalogId: m.entry.id,
    sizeMB: Math.round(statSync(model).size / MB),
    onGpu,
    perf: { ...perfFields(m), device: onGpu ? "gpu" : "cpu" },
  });
}

async function embed(m: ResolvedModel, texts: string[], mode: "query" | "doc"): Promise<Float32Array[]> {
  const s = await serverFor(m, "embedding");
  const prefix = mode === "query" ? instruction(m.entry.queryInstruction, m) : m.entry.docInstruction;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += LLAMA_BATCH) {
    const input = texts.slice(i, i + LLAMA_BATCH).map((t) => prefix + t);
    const j = await serverPost<{
      data?: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number };
    }>(s, "/v1/embeddings", {
      input,
      encoding_format: "float",
    });
    if (j.usage?.prompt_tokens) addTokens(j.usage.prompt_tokens);
    const data = j.data ?? [];
    if (data.length !== input.length)
      throw new UserError(`llama-server returned ${data.length} vectors for ${input.length} texts.`);
    for (const d of [...data].sort((a, b) => a.index - b.index)) out.push(Float32Array.from(d.embedding));
  }
  return out;
}

async function rerank(m: ResolvedModel, query: string, texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  const s = await serverFor(m, "rerank");
  const j = await serverPost<{
    results?: { index: number; relevance_score: number }[];
    usage?: { prompt_tokens?: number };
  }>(s, "/v1/rerank", {
    query,
    documents: texts,
    top_n: texts.length,
  });
  if (j.usage?.prompt_tokens) addTokens(j.usage.prompt_tokens);
  const scores: number[] = new Array(texts.length).fill(Number.NaN);
  for (const r of j.results ?? []) scores[r.index] = r.relevance_score;
  if (scores.some((x) => Number.isNaN(x)))
    throw new UserError(`llama-server returned ${j.results?.length ?? 0} scores for ${texts.length} passages.`);
  return scores;
}

export const llamacppRuntime: Runtime = {
  probe: async (m) => {
    const maxTokens = Math.min(m.entry.maxInputTokens, LLAMA_CTX);
    if (m.entry.kind === "reranker") {
      await rerank(m, "probe", ["Testimus probe sentence."]);
      return { dims: 1, maxTokens };
    }
    const [v] = await embed(m, ["Testimus probe sentence."], "doc");
    return { dims: v.length, maxTokens };
  },
  embed,
  rerank,
};
