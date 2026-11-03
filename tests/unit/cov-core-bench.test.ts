import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLedger } from "../../src/core/claude/ledger.ts";
import { quietCtx } from "../../src/core/command.ts";
import { env } from "../../src/core/env.ts";
import { writeJson } from "../../src/core/lib/project.ts";
import { activeChoice } from "../../src/core/rag/activation.ts";
import { benchHooks, runBench } from "../../src/core/rag/bench.ts";
import { hooks } from "../../src/core/rag/chunk.ts";
import { indexFile } from "../../src/core/rag/db.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const real = { mock: env.mock, hooks: { ...benchHooks } };
let dir: string;
let calls: { name: string; input: Record<string, unknown> }[];

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-cov-bench-")), "P");
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
  hooks.describeChunks = null;
  calls = [];
});

afterEach(() => {
  env.mock = real.mock;
  Object.assign(benchHooks, real.hooks);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

function validatedSet(): string {
  const f = join(dir, "eval", "ok.jsonl");
  writeFileSync(
    f,
    `${JSON.stringify({
      id: "b1",
      question: "Q ?",
      evidence: [{ ref: "SOSIE_211_D401-1_3#§5.6.6", role: "rule" }],
      validated: true,
    })}\n`,
  );
  return f;
}

describe("bench hooks by default", () => {
  it("read and write the active choice, and index through the registry", async () => {
    expect(benchHooks.current(dir)).toBeNull();
    benchHooks.activate(dir, { pack: "light" });
    expect(activeChoice(dir)).toEqual({ pack: "light" });
    benchHooks.activate(dir, null);
    expect(activeChoice(dir)).toBeNull();
    await benchHooks.prepare(dir, quietCtx(dir));
    expect(existsSync(indexFile(dir))).toBe(true);
  }, 30000);
});

describe("the ledger the bench reads", () => {
  it("is the generation's: null without a gen folder or without its file, its run and refs with it", () => {
    expect(readLedger(dir, "g1")).toBeNull();
    const gen = join(dir, ".testimus", "gen");
    mkdirSync(gen, { recursive: true });
    writeJson(join(gen, "a.json"), { runId: "other" });
    writeFileSync(join(gen, "b.txt"), "x");
    expect(readLedger(dir, "g1")).toBeNull();
    writeJson(join(gen, "g1.json"), { runId: "r1", consulted: ["x"] });
    expect(readLedger(dir, "g1")).toEqual({ jobId: "g1", runId: "r1", consulted: ["x"], searched: [] });
  });
});

describe("runBench with fake runs", () => {
  beforeEach(() => {
    benchHooks.prepare = async () => {};
    benchHooks.activate = () => {};
  });

  it("no index: refs resolve to nothing; model and effort are passed; a failed revert is a note", async () => {
    benchHooks.current = () => {
      throw new Error("no settings");
    };
    const activated: unknown[] = [];
    benchHooks.activate = (_p, c) => {
      activated.push(c);
    };
    benchHooks.invoke = async (name, input) => {
      calls.push({ name, input: input as Record<string, unknown> });
      if (name === "claude.revert") throw "locked";
      const gen = join(dir, ".testimus", "gen");
      mkdirSync(gen, { recursive: true });
      writeJson(join(gen, "run1.json"), { runId: "run1", consulted: ["SOSIE_211_D401-1_3#§5.6.6", 3] });
      return { runId: "run1", generation: "run1", ok: true, tests: ["T-1"], durationMs: 5 };
    };
    const r = await runBench(dir, quietCtx(dir), {
      set: validatedSet(),
      behaviors: ["b1"],
      configs: [{ embedding: "bge-m3", reranker: null }],
      runs: 1,
      model: "opus",
      effort: "low",
    });
    expect(calls[0]).toMatchObject({ name: "gen.tests", input: { model: "opus", effort: "low", check: true } });
    expect(r.rows[0]).toMatchObject({ ok: true, agenticRecall: 1, consulted: 1, tests: 1 });
    expect(r.rows[0].costUsd).toBeUndefined();
    expect(r.notes).toEqual(["Could not remove the tests of run1: locked"]);
    expect(r.provisional).toBe(false);
    expect(r.summary[0]).toMatchObject({ config: "bge-m3+none", costUsd: 0, agenticRecall: 1 });
    expect(activated).toEqual([{ embedding: "bge-m3", reranker: null }]);
  });

  it("a run that throws a non-Error, a revert that throws an Error, a missing ledger", async () => {
    let n = 0;
    benchHooks.current = () => null;
    benchHooks.invoke = async (name) => {
      if (name === "claude.revert") throw new Error("busy");
      if (++n === 1) throw "exploded";
      if (n === 2) throw new Error("gen failed");
      return { runId: "nope", ok: true, tests: ["T-2"], durationMs: 1, costUsd: 0.5 };
    };
    const r = await runBench(dir, quietCtx(dir), {
      set: validatedSet(),
      behaviors: ["b1"],
      configs: [{ pack: "light" }],
      runs: 3,
    });
    expect(r.rows[0]).toMatchObject({ ok: false, error: "exploded" });
    expect(r.rows[1]).toMatchObject({ ok: false, error: "gen failed" });
    expect(r.rows[2]).toMatchObject({ ok: true, agenticRecall: null, costUsd: 0.5 });
    expect(r.notes.join("\n")).toMatch(/busy/);
    expect(r.notes.join("\n")).toMatch(/no consulted list/);
  });

  it("stops when cancelled; with no run the summary has no recall", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runBench(dir, quietCtx(dir, ctrl.signal), {
        set: validatedSet(),
        behaviors: ["b1"],
        configs: [{ pack: "light" }],
        runs: 1,
      }),
    ).rejects.toThrow(/Benchmark cancelled/);
    const r = await runBench(dir, quietCtx(dir), {
      set: validatedSet(),
      behaviors: ["b1"],
      configs: [{ pack: "light" }],
      runs: 0,
    });
    expect(r.summary[0]).toMatchObject({ runs: 0, agenticRecall: null, tests: 0 });
  });

  it("a test kept on request is not reverted; the default set of the project is used", async () => {
    benchHooks.invoke = async (name) => {
      calls.push({ name, input: {} });
      return { runId: "r", ok: false, tests: [], durationMs: 1 };
    };
    const r = await runBench(dir, quietCtx(dir), {
      behaviors: ["sectionneur-sans-tk-menu"],
      configs: [{ pack: "light" }],
      runs: 1,
      keep: true,
      check: false,
    });
    expect(calls.map((c) => c.name)).toEqual(["gen.tests"]);
    expect(r.provisional).toBe(true);
  });
});
