import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import { sha256 } from "../../src/core/lib/hash.ts";
import { catalogEntry } from "../../src/core/lib/models-catalog.ts";
import { journalFile, readPerf, timeOp } from "../../src/core/lib/models-perf.ts";
import { crc32, writeZip } from "../../src/core/lib/zip.ts";
import { serverIo } from "../../src/core/rag/runtimes/llama-server.ts";
import {
  extractZip,
  LLAMA_ASSETS,
  llamacppConfig,
  llamacppRuntime,
  llamaIo,
  pullLlamaBuild,
  stopAllServers,
} from "../../src/core/rag/runtimes/llamacpp.ts";
import type { ResolvedModel } from "../../src/core/types.ts";

const saved = { io: { ...serverIo }, http: env.http, download: llamaIo.download, cpu: LLAMA_ASSETS.cpu };
const enc = new TextEncoder();
let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "testimus-cov-llama-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await stopAllServers();
  Object.assign(serverIo, saved.io);
  env.http = saved.http;
  llamaIo.download = saved.download;
  LLAMA_ASSETS.cpu = saved.cpu;
  llamacppConfig.build = null;
  rmSync(tmp, { recursive: true, force: true });
});

type Stored = { name: string; data: Uint8Array };

function storedZip(entries: Stored[]): { bytes: Buffer; cdAt: number; eocdAt: number } {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, Buffer.from(e.data));
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...locals, cd, eocd]), cdAt: offset, eocdAt: offset + cd.length };
}

function zipFile(bytes: Uint8Array): string {
  const f = join(tmp, `z${Math.random().toString(36).slice(2)}.zip`);
  writeFileSync(f, bytes);
  return f;
}

describe("extractZip", () => {
  it("extracts stored entries and skips folder entries", () => {
    const { bytes } = storedZip([
      { name: "dir/", data: new Uint8Array() },
      { name: "a.txt", data: enc.encode("stored a") },
      { name: "dir/b.txt", data: enc.encode("stored b") },
    ]);
    const out = join(tmp, "out");
    expect(extractZip(zipFile(bytes), out).sort()).toEqual(["a.txt", "dir/b.txt"]);
    expect(readFileSync(join(out, "dir", "b.txt"), "utf8")).toBe("stored b");
  });

  it("refuses what is not a zip, Zip64, a corrupt directory, an unknown method and a bad CRC", () => {
    const out = join(tmp, "out");
    expect(() => extractZip(zipFile(enc.encode("hello, not a zip at all, long enough")), out)).toThrow(
      /Not a zip file/,
    );
    const base = () => storedZip([{ name: "a.txt", data: enc.encode("x") }]);

    const count = base();
    count.bytes.writeUInt16LE(0xffff, count.eocdAt + 10);
    expect(() => extractZip(zipFile(count.bytes), out)).toThrow(/Zip64/);

    const off = base();
    off.bytes.writeUInt32LE(0xffffffff, off.eocdAt + 16);
    expect(() => extractZip(zipFile(off.bytes), out)).toThrow(/Zip64/);

    const sig = base();
    sig.bytes.writeUInt32LE(0x12345678, sig.cdAt);
    expect(() => extractZip(zipFile(sig.bytes), out)).toThrow(/Corrupt zip:/);

    const csize = base();
    csize.bytes.writeUInt32LE(0xffffffff, csize.cdAt + 20);
    expect(() => extractZip(zipFile(csize.bytes), out)).toThrow(/Zip64/);

    const local = base();
    local.bytes.writeUInt32LE(0xffffffff, local.cdAt + 42);
    expect(() => extractZip(zipFile(local.bytes), out)).toThrow(/Zip64/);

    const method = base();
    method.bytes.writeUInt16LE(12, method.cdAt + 10);
    expect(() => extractZip(zipFile(method.bytes), out)).toThrow(/Unsupported zip compression 12/);

    const crc = base();
    crc.bytes.writeUInt32LE(1, crc.cdAt + 16);
    expect(() => extractZip(zipFile(crc.bytes), out)).toThrow(/Corrupt zip entry a.txt/);
  });
});

describe("pullLlamaBuild", () => {
  const zip = writeZip([
    { name: "llama-server.exe", data: enc.encode("MZ") },
    { name: "ggml.dll", data: enc.encode("dll") },
  ]);
  const asset = (bytes: Uint8Array) => {
    LLAMA_ASSETS.cpu = [{ name: "llama-b12032-bin-win-cpu-x64.zip", sha256: sha256(bytes), size: bytes.length }];
  };

  it("refuses when the disk has not room for three times the downloads", async () => {
    LLAMA_ASSETS.cpu = [{ name: "big.zip", sha256: "0".repeat(64), size: 2 ** 52 }];
    await expect(pullLlamaBuild("cpu", tmp, () => {}, new AbortController().signal)).rejects.toThrow(
      /Not enough free space/,
    );
  });

  it("reuses a zip already downloaded with the right size and SHA-256", async () => {
    asset(zip);
    const dl = join(tmp, "b12032-cpu", ".download");
    mkdirSync(dl, { recursive: true });
    writeFileSync(join(dl, LLAMA_ASSETS.cpu[0].name), zip);
    llamaIo.download = async () => {
      throw new Error("must not download");
    };
    const seen: number[] = [];
    const rt = await pullLlamaBuild("cpu", tmp, (p) => seen.push(p.loaded), new AbortController().signal);
    expect(rt.via).toBe("download");
    expect(seen).toEqual([zip.length]);
  });

  it("passes a download error on, and uses the asset size when the total is unknown", async () => {
    asset(zip);
    const seen: number[] = [];
    llamaIo.download = async (_u, _f, onBytes) => {
      onBytes(3, 0);
      throw new Error("HTTP 500");
    };
    await expect(pullLlamaBuild("cpu", tmp, (p) => seen.push(p.total), new AbortController().signal)).rejects.toThrow(
      /HTTP 500/,
    );
    expect(seen).toEqual([zip.length]);
  });

  it("a cancel that lands after the download ends deletes the part file", async () => {
    asset(zip);
    const ctrl = new AbortController();
    llamaIo.download = async (_u, file) => {
      writeFileSync(file, zip);
      ctrl.abort();
    };
    await expect(pullLlamaBuild("cpu", tmp, () => {}, ctrl.signal)).rejects.toThrow(/cancelled/);
    expect(existsSync(join(tmp, "b12032-cpu", ".download", `${LLAMA_ASSETS.cpu[0].name}.part`))).toBe(false);
  });

  it("a zip without llama-server.exe is an error", async () => {
    const bad = writeZip([{ name: "readme.txt", data: enc.encode("no server") }]);
    asset(bad);
    llamaIo.download = async (_u, file) => {
      writeFileSync(file, bad);
    };
    await expect(pullLlamaBuild("cpu", tmp, () => {}, new AbortController().signal)).rejects.toThrow(
      /llama-server.exe is missing/,
    );
  });
});

describe("llamaIo.download (fetch)", () => {
  it("streams the body to the file with progress", async () => {
    const body = enc.encode("0123456789");
    vi.stubGlobal(
      "fetch",
      async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
    );
    const seen: [number, number][] = [];
    const f = join(tmp, "dl.bin");
    await llamaIo.download("https://example.invalid/x", f, (l, t) => seen.push([l, t]), new AbortController().signal);
    expect(readFileSync(f, "utf8")).toBe("0123456789");
    expect(seen.at(-1)).toEqual([10, 10]);
  });

  it("without a content length the total is 0", async () => {
    vi.stubGlobal("fetch", async () => {
      const r = new Response(
        new ReadableStream({
          start: (c) => {
            c.enqueue(enc.encode("ab"));
            c.close();
          },
        }),
      );
      r.headers.delete("content-length");
      return r;
    });
    const seen: number[] = [];
    await llamaIo.download(
      "https://example.invalid/x",
      join(tmp, "d2"),
      (_l, t) => seen.push(t),
      new AbortController().signal,
    );
    expect(seen).toEqual([0]);
  });

  it("fails on an HTTP error or a missing body", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    await expect(
      llamaIo.download("https://example.invalid/x", join(tmp, "d3"), () => {}, new AbortController().signal),
    ).rejects.toThrow(/HTTP 404/);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    await expect(
      llamaIo.download("https://example.invalid/x", join(tmp, "d4"), () => {}, new AbortController().signal),
    ).rejects.toThrow(/HTTP 200/);
  });
});

describe("runtime answers that do not fit", () => {
  const json = (status: number, body: unknown): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });
  let answer: (req: HttpReq) => HttpRes;

  function setup(backend: "cuda" | "cpu" = "cuda"): { emb: ResolvedModel; rr: ResolvedModel } {
    const exe = join(tmp, "llama-server.exe");
    writeFileSync(exe, "");
    llamacppConfig.build = { exe, build: "b12032", backend, via: "path" };
    for (const f of ["e.gguf", "r.gguf"]) writeFileSync(join(tmp, f), "gguf");
    serverIo.spawn = () => ({ pid: 9, onOutput: () => {}, exited: new Promise(() => {}) });
    serverIo.freePort = async () => 51500;
    serverIo.kill = async () => {};
    serverIo.randomKey = () => "secret";
    serverIo.vramUsedMB = async () => null;
    env.http = async (req) => (req.url.endsWith("/health") ? json(200, { status: "ok" }) : answer(req));
    const model = (id: string, path: string | undefined): ResolvedModel => ({
      entry: catalogEntry(id) as ResolvedModel["entry"],
      install: { model: id, via: "path", runtime: "llamacpp", ...(path ? { path } : {}), status: "installed" },
      runtime: "llamacpp",
      device: "gpu",
      queryTask: "Find passages",
    });
    return {
      emb: model("qwen3-embedding-0.6b-q8", join(tmp, "e.gguf")),
      rr: model("qwen3-reranker-0.6b-q8", join(tmp, "r.gguf")),
    };
  }

  it("counts the tokens llama-server reports, on embed and rerank, on a CPU build", async () => {
    rmSync(journalFile(), { force: true });
    const { emb, rr } = setup("cpu");
    answer = (req) => {
      const body = JSON.parse(req.body ?? "{}");
      if (req.url.endsWith("/v1/embeddings"))
        return json(200, {
          data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 2] })),
          usage: { prompt_tokens: 5 },
        });
      return json(200, { results: [{ index: 0, relevance_score: 0.9 }], usage: { prompt_tokens: 7 } });
    };
    await timeOp("embed.query", { model: "e", runtime: "llamacpp", device: "cpu" }, 1, () =>
      llamacppRuntime.embed(emb, ["a"], "doc"),
    );
    await timeOp("rerank", { model: "r", runtime: "llamacpp", device: "cpu" }, 1, () =>
      llamacppRuntime.rerank(rr, "q", ["a"]),
    );
    const lines = readPerf().filter((l) => l.op !== "model.load");
    expect(lines.map((l) => l.tokens)).toEqual([5, 7]);
    const loads = readPerf().filter((l) => l.op === "model.load");
    expect(loads.every((l) => l.device === "cpu")).toBe(true);
  });

  it("too few vectors or scores is an error", async () => {
    const { emb, rr } = setup();
    answer = (req) => (req.url.endsWith("/v1/embeddings") ? json(200, {}) : json(200, {}));
    await expect(llamacppRuntime.embed(emb, ["a", "b"], "doc")).rejects.toThrow(/returned 0 vectors for 2 texts/);
    await expect(llamacppRuntime.rerank(rr, "q", ["a", "b"])).rejects.toThrow(/returned 0 scores for 2 passages/);
    answer = () => json(200, { results: [{ index: 1, relevance_score: 0.2 }] });
    await expect(llamacppRuntime.rerank(rr, "q", ["a", "b"])).rejects.toThrow(/returned 1 scores for 2 passages/);
  });

  it("a model without a path, or not a GGUF, is missing", async () => {
    const { emb } = setup();
    await expect(
      llamacppRuntime.embed({ ...emb, install: { ...emb.install, path: undefined } }, ["x"], "doc"),
    ).rejects.toThrow(/no path/);
    const onnx = join(tmp, "model.onnx");
    writeFileSync(onnx, "");
    await expect(
      llamacppRuntime.embed({ ...emb, install: { ...emb.install, path: onnx } }, ["x"], "doc"),
    ).rejects.toThrow(/GGUF file is missing/);
  });
});
