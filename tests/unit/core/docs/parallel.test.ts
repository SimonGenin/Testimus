import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { AGENTS_START, agentPool, conversionPool, WEIGHT_MB } from "../../../../src/core/lib/agents.ts";
import { conversionSlot, queueIndex } from "../../../../src/core/lib/docs-index.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
  writeSettings(DEFAULT_SETTINGS);
});

const agents = (max: number) => writeSettings({ ...DEFAULT_SETTINGS, agents: { max, adaptive: false } });

function deferred() {
  let open = () => {};
  let fail = (_e: Error) => {};
  const p = new Promise<void>((ok, ko) => {
    open = ok;
    fail = ko;
  });
  return { p, open, fail };
}

const tick = () => new Promise((r) => setImmediate(r));

const machine = (freeMB: number) => ({
  cpus: () => ({ idle: 0, total: 0 }),
  freeMB: () => freeMB,
  everyMs: 3_600_000,
});

describe("the conversion pool", () => {
  it("is the agents setting, never more than the cores but one when adaptive, starting at two", () => {
    expect(conversionPool({ max: 5, adaptive: false }, 2).limit()).toBe(5);
    expect(conversionPool({ max: 5, adaptive: true }, 16).limit()).toBe(AGENTS_START);
    expect(conversionPool({ max: 5, adaptive: true }, 1).limit()).toBe(1);
  });

  it("on a 16 GB PC with 6 GB free, three videos do not start together; Word documents do", async () => {
    const pool = agentPool({ max: 3, adaptive: true, deps: machine(6000) });
    const warm = [deferred(), deferred()];
    const busy = warm.map((g) => pool.run(() => g.p));
    await tick();
    pool.tick();
    expect(pool.limit()).toBe(3);
    for (const g of warm) g.open();
    await Promise.all(busy);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const waited: number[] = [];
    const runs = gates.map((g, i) =>
      pool.run(
        async () => {
          started.push(i);
          await g.p;
        },
        { weightMB: WEIGHT_MB.video, onWait: () => waited.push(i) },
      ),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    expect(waited).toEqual([2]);
    gates[0].open();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1].open();
    gates[2].open();
    await Promise.all(runs);

    const tight = agentPool({ max: 3, adaptive: true, deps: machine(3000) });
    const v = [deferred(), deferred()];
    const went: number[] = [];
    const videos = v.map((g, i) =>
      tight.run(
        async () => {
          went.push(i);
          await g.p;
        },
        { weightMB: WEIGHT_MB.video },
      ),
    );
    await tick();
    expect(went).toEqual([0]);
    v[0].open();
    v[1].open();
    await Promise.all(videos);
    expect(went).toEqual([0, 1]);

    const words = agentPool({ max: 2, adaptive: true, deps: machine(3000) });
    const w = [deferred(), deferred()];
    let together = 0;
    const docs = w.map((g) =>
      words.run(
        async () => {
          together++;
          await g.p;
        },
        { weightMB: WEIGHT_MB.document },
      ),
    );
    await tick();
    expect(together).toBe(2);
    for (const g of w) g.open();
    await Promise.all(docs);
  });

  it("a waiting task whose signal aborts leaves the queue; the one before it is not held", async () => {
    const pool = agentPool({ max: 1, adaptive: false });
    const gate = deferred();
    const first = pool.run(() => gate.p);
    const ctl = new AbortController();
    const second = pool.run(async () => "never", { signal: ctl.signal });
    ctl.abort(new Error("cancelled while waiting"));
    await expect(second).rejects.toThrow("cancelled while waiting");
    gate.open();
    await first;
    expect(await pool.run(async () => "next")).toBe("next");
  });
});

describe("the conversion slots of a project", () => {
  it("run as many conversions as the setting allows, the others wait their turn; a failure frees its slot", async () => {
    agents(2);
    const P = fixtureCopy("slots");
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let most = 0;
    const waited: number[] = [];
    const runs = gates.map((g, i) =>
      conversionSlot(
        P,
        async () => {
          active++;
          most = Math.max(most, active);
          try {
            await g.p;
            return i;
          } finally {
            active--;
          }
        },
        { onWait: () => waited.push(i) },
      ),
    );
    await tick();
    expect(active).toBe(2);
    expect(waited).toEqual([2, 3]);
    gates[0].fail(new Error("unreadable"));
    await tick();
    expect(active).toBe(2);
    gates[1].open();
    gates[2].open();
    gates[3].open();
    const ends = await Promise.allSettled(runs);
    expect(ends.map((e) => e.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
    expect(most).toBe(2);
  });

  it("never hold an index pass: it runs while conversions go or wait for a place", async () => {
    agents(1);
    const P = fixtureCopy("slots-index");
    const a = deferred();
    const b = deferred();
    const order: string[] = [];
    const one = conversionSlot(P, async () => {
      await a.p;
      order.push("a");
    });
    const two = conversionSlot(P, async () => {
      await b.p;
      order.push("b");
    });
    const index = queueIndex(P, async () => {
      order.push("index");
    });
    await index;
    expect(order).toEqual(["index"]);
    a.open();
    b.open();
    await Promise.all([one, two]);
    expect(order).toEqual(["index", "a", "b"]);
  });

  it("a shared index run is not cancelled by one of those waiting for it, only once all of them cancelled", async () => {
    const P = fixtureCopy("slots-shared");
    const gate = deferred();
    const busy = queueIndex(P, () => gate.p);
    const a = new AbortController();
    const b = new AbortController();
    const signals: AbortSignal[] = [];
    const run = async (signal: AbortSignal) => {
      signals.push(signal);
      if (signal.aborted) throw new Error("index cancelled");
      return "indexed";
    };
    const forA = queueIndex(P, run, { signal: a.signal });
    const forB = queueIndex(P, run, { signal: b.signal });
    a.abort(new Error("A cancelled"));
    await expect(forA).rejects.toThrow("A cancelled");
    gate.open();
    await busy;
    expect(await forB).toBe("indexed");
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    const gate2 = deferred();
    const busy2 = queueIndex(P, () => gate2.p);
    const c = new AbortController();
    const d = new AbortController();
    const forC = queueIndex(P, run, { signal: c.signal });
    const forD = queueIndex(P, run, { signal: d.signal });
    c.abort(new Error("C cancelled"));
    d.abort(new Error("D cancelled"));
    await expect(forC).rejects.toThrow("C cancelled");
    await expect(forD).rejects.toThrow("D cancelled");
    gate2.open();
    await busy2;
    await tick();
    expect(signals).toHaveLength(1);
    expect(await queueIndex(P, run)).toBe("indexed");
    expect(signals).toHaveLength(2);
  });
});

describe("several documents converted together", () => {
  it("convert a few at a time, each in its own job; one that fails stops none of the others; the index follows them", async () => {
    agents(2);
    const P = fixtureCopy("parallel");
    const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
    for (const n of ["PA", "PB", "PC", "PD"]) writeFileSync(join(dir, `SPEC_${n}_01_00.docx`), sampleDocx());
    writeFileSync(join(dir, "SPEC_PX_01_00.docx"), "not a zip");
    const r = await call<{ converted: { id: string; status: string }[] }>(
      "docs.addFolder",
      { dir, describeFigures: false },
      P,
    );
    expect(r.converted.map((c) => [c.id, c.status])).toEqual([
      ["SPEC_PA", "done"],
      ["SPEC_PB", "done"],
      ["SPEC_PC", "done"],
      ["SPEC_PD", "done"],
      ["SPEC_PX", "failed"],
    ]);
    const jobs = listJobs(P);
    const converts = jobs.filter((j) => j.kind === "docs.convert");
    expect(converts).toHaveLength(5);
    const waited = converts.filter((j) => j.steps?.some((s) => s.id === "queue" && s.status === "done"));
    expect(waited.length).toBeGreaterThanOrEqual(3);
    const passes = jobs.filter((j) => j.kind === "rag-index").length;
    expect(passes).toBeGreaterThanOrEqual(1);
    expect(passes).toBeLessThanOrEqual(4);
    const listed = await call<{ id: string; indexed: string }[]>("docs.list", {}, P);
    expect(
      listed
        .filter((d) => d.id.startsWith("SPEC_P") && d.id !== "SPEC_PX")
        .map((d) => d.indexed)
        .every((s) => s === "fresh"),
    ).toBe(true);
  });
});
