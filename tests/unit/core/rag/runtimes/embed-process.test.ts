import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogEntry } from "../../../../../src/core/lib/models-catalog.ts";
import { installDeps } from "../../../../../src/core/lib/models-install.ts";
import { journalFile, readPerf, withPerfScope } from "../../../../../src/core/lib/models-perf.ts";
import { embedWith, probeWith, runtimes } from "../../../../../src/core/rag/embed.ts";
import {
  IDLE_MS,
  liveWorkers,
  stopEmbedWorkers,
  sweepIdle,
  transformersProcessRuntime,
  workerIo,
  workerTimeouts,
} from "../../../../../src/core/rag/runtimes/embed-process.ts";
import { stopAllServers } from "../../../../../src/core/rag/runtimes/llamacpp.ts";
import { transformersRuntime } from "../../../../../src/core/rag/runtimes/transformers.ts";
import type { CatalogEntry, ResolvedModel } from "../../../../../src/core/types.ts";
import { isAlive } from "../../../../../src/shared/run/process.ts";
import { fakeVector } from "../../../helpers/fake-embed-worker.ts";

const FAKE = fileURLToPath(new URL("../../../helpers/fake-embed-worker.ts", import.meta.url));
const saved = { ...workerIo };
const idle = workerTimeouts.idleMs;

function model(path = "D:/models/BAAI/bge-m3", patch: Partial<CatalogEntry> = {}): ResolvedModel {
  const entry = { ...(catalogEntry("bge-m3-q8") as CatalogEntry), ...patch };
  return {
    entry,
    install: { model: entry.id, via: "path", runtime: "transformers", path, status: "installed" },
    runtime: "transformers",
    device: "cpu",
    queryTask: "Find passages",
  } as ResolvedModel;
}

beforeEach(() => {
  workerIo.script = () => FAKE;
  if (existsSync(journalFile())) rmSync(journalFile());
});

afterEach(async () => {
  await stopEmbedWorkers();
  Object.assign(workerIo, saved);
  workerTimeouts.idleMs = idle;
});

describe("the embed worker, seen from the core", () => {
  it("is the runtime of transformers.js embeddings; the program it starts is the worker file beside it", () => {
    expect(runtimes.transformers).toBe(transformersProcessRuntime);
    expect(existsSync(saved.script())).toBe(true);
    expect(saved.script()).toMatch(/embed-worker\.ts$/);
    expect(IDLE_MS).toBe(10 * 60 * 1000);
  });

  it("embeds in a child process, low priority, told its threads — the same vectors as computed here", async () => {
    const texts = ["Le frein de stationnement", "La vitesse dépasse 5 km/h", "§5.6.6 Sectionneur"];
    const out = await embedWith(model(), texts, "doc");
    expect(out.map((v) => Array.from(v))).toEqual(texts.map((t) => Array.from(fakeVector(t))));
    const [w] = liveWorkers();
    expect(w.proc.pid).toBeTypeOf("number");
    expect(w.proc.pid).not.toBe(process.pid);
    expect(w.threads).toBeGreaterThanOrEqual(1);
    expect(w.stderr.join("\n")).toContain(`fake worker, threads ${w.threads}`);
    const [q] = await embedWith(model(), ["frein"], "query");
    expect(Array.from(q)).toEqual(Array.from(fakeVector("frein")));
    expect(liveWorkers()).toHaveLength(1);
  });

  it("the doc and query instructions are put before the texts, as in the core", async () => {
    const m = model(undefined, { docInstruction: "passage: ", queryInstruction: "query: " });
    const [d] = await embedWith(m, ["a"], "doc");
    const [q] = await embedWith(m, ["a"], "query");
    expect(Array.from(d)).toEqual(Array.from(fakeVector("passage: a")));
    expect(Array.from(q)).toEqual(Array.from(fakeVector("query: a")));
    expect(await embedWith(m, [], "doc")).toEqual([]);
  });

  it("the timings journal gets the worker's load and each call's tokens, the load left out of the call", async () => {
    await withPerfScope({ fingerprint: "abc", project: "p" }, () => embedWith(model(), ["un deux trois"], "query"));
    await embedWith(model(), ["quatre"], "query");
    const lines = readPerf();
    expect(lines.map((l) => l.op)).toEqual(["model.load", "embed.query", "embed.query"]);
    expect(lines[0]).toMatchObject({ model: "bge-m3-q8", runtime: "transformers", device: "cpu", items: 1 });
    expect(lines[0].peakRssMB).toBeGreaterThan(10);
    expect(lines[1]).toMatchObject({ tokens: 3, fingerprint: "abc", project: "p" });
    expect(lines[1].loadMs).toBeGreaterThanOrEqual(0);
    expect(lines[2].loadMs).toBeUndefined();
  });

  it("a probe asks the worker for one vector: its size and the model's limit", async () => {
    expect(await probeWith(model())).toEqual({ dims: 8, maxTokens: 8192 });
  });

  it("an error in the worker fails that call only; a load that fails for memory is journaled", async () => {
    await expect(embedWith(model(), ["fine", "oom"], "doc")).rejects.toThrow("bad_alloc while embedding");
    expect(await embedWith(model(), ["fine"], "doc")).toHaveLength(1);
    await expect(embedWith(model("D:/models/org/badload"), ["x"], "doc")).rejects.toThrow(/Failed to allocate/);
    expect(readPerf().filter((l) => l.op === "model.load" && l.oom)).toHaveLength(1);
  });

  it("a cancelled job leaves at once; the worker drops the rest of the batch and serves the next ask", async () => {
    const ctrl = new AbortController();
    const slow = withPerfScope(
      {},
      () => embedWith(model(), ["slow 1", "slow 2", "slow 3", "slow 4"], "doc"),
      ctrl.signal,
    );
    while (!liveWorkers()[0]?.busy) await new Promise((r) => setImmediate(r));
    const t0 = Date.now();
    ctrl.abort();
    await expect(slow).rejects.toThrow(/Cancelled/);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(liveWorkers()[0].busy).toBe(0);
    expect(await embedWith(model(), ["next"], "doc")).toHaveLength(1);
    const pre = new AbortController();
    pre.abort();
    await expect(withPerfScope({}, () => embedWith(model(), ["x"], "doc"), pre.signal)).rejects.toThrow(/Cancelled/);
  });

  it("a worker that dies fails what it was doing with its last words, and the next call starts another", async () => {
    await embedWith(model(), ["warm"], "doc");
    const first = liveWorkers()[0];
    await expect(embedWith(model(), ["crash"], "doc")).rejects.toThrow(
      /The embedding process stopped \(exit code 3\)\.\nfake worker, threads/,
    );
    expect(liveWorkers()).toEqual([]);
    expect(await embedWith(model(), ["again"], "doc")).toHaveLength(1);
    expect(liveWorkers()[0]).not.toBe(first);
  });

  it("stops after the idle delay, not while it works; the memory goes with the process", async () => {
    let now = 1_000_000;
    workerIo.now = () => now;
    await embedWith(model(), ["a"], "doc");
    const w = liveWorkers()[0];
    const pid = w.proc.pid as number;
    now += IDLE_MS - 1;
    expect(await sweepIdle(now)).toEqual([]);
    w.busy++;
    now += 2;
    expect(await sweepIdle(now)).toEqual([]);
    w.busy--;
    expect(await sweepIdle(now)).toEqual([w.key]);
    await w.proc.exited;
    expect(isAlive(pid)).toBe(false);
    expect(liveWorkers()).toEqual([]);
  });

  it("the idle delay can be shortened, and the sweep then runs by itself", async () => {
    workerTimeouts.idleMs = 300;
    await embedWith(model(), ["a"], "doc");
    const w = liveWorkers()[0];
    await w.proc.exited;
    expect(liveWorkers()).toEqual([]);
  });

  it("another model gets its own worker and the idle one of the previous model goes", async () => {
    await embedWith(model("D:/models/a"), ["a"], "doc");
    const a = liveWorkers()[0];
    await embedWith(model("D:/models/b"), ["b"], "doc");
    await a.proc.exited;
    expect(liveWorkers().map((w) => w.key)).toEqual([expect.stringContaining("D:")]);
    expect(liveWorkers()[0]).not.toBe(a);
  });

  it("stopping Testimus' model processes takes the embed workers too", async () => {
    await embedWith(model(), ["a"], "doc");
    const w = liveWorkers()[0];
    await stopAllServers();
    await w.proc.exited;
    expect(liveWorkers()).toEqual([]);
  });

  it("a worker that cannot start fails the call and says why", async () => {
    workerIo.start = (args, onLine) => saved.start(["D:/nowhere/embed-worker-missing.ts", ...args.slice(1)], onLine);
    await expect(embedWith(model(), ["a"], "doc")).rejects.toThrow(/The embedding process stopped \(exit code 1\)/);
  });

  it("a reranker still probes and reranks in this process", async () => {
    const probe = vi.spyOn(transformersRuntime, "probe").mockResolvedValue({ dims: 1, maxTokens: 512 });
    const rerank = vi.spyOn(transformersRuntime, "rerank").mockResolvedValue([0.5]);
    const r = { ...model(), entry: { ...model().entry, kind: "reranker" as const } };
    expect(await transformersProcessRuntime.probe(r)).toEqual({ dims: 1, maxTokens: 512 });
    expect(await transformersProcessRuntime.rerank(r, "q", ["t"])).toEqual([0.5]);
    expect(probe).toHaveBeenCalledWith(r);
    expect(rerank).toHaveBeenCalledWith(r, "q", ["t"]);
    expect(liveWorkers()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("the install probe", () => {
  it("stops the embed worker it started, as it does the llama-servers", async () => {
    const p = await installDeps.probe(model());
    expect(p.dims).toBe(fakeVector("probe").length);
    expect(liveWorkers()).toEqual([]);
  });

  it("leaves a worker that was already running for the index or a search", async () => {
    await embedWith(model(), ["déjà là"], "doc");
    const [running] = liveWorkers();
    await installDeps.probe(model());
    expect(liveWorkers()).toEqual([running]);
    expect(running.exitCode).toBeUndefined();
  });
});
