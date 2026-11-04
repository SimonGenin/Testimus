import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Ctx, quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, readJson, writeJson, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-check.ts";
import "../../../../src/core/mock/claude-gen.ts";
import { readLedger } from "../../../../src/core/claude/ledger.ts";
import { activeChoice } from "../../../../src/core/rag/activation.ts";
import { agenticRecall, type BenchReport, benchHooks, configLabel, runBench } from "../../../../src/core/rag/bench.ts";
import { indexFile } from "../../../../src/core/rag/db.ts";
import { chunkResolver } from "../../../../src/core/rag/eval-score.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import type { ActiveChoice, RagChoice } from "../../../../src/core/types.ts";

describe("gen.bench", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
  const D3 = "SOSIE_211_D401-1_3";
  const D4 = "SOSIE_211_D401-1_4";
  const real = { spawn: env.spawnClaude, mock: env.mock, hooks: { ...benchHooks } };
  let dir: string;
  let active: (RagChoice | ActiveChoice | null)[];

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "testimus-bench-")), "LFRPS12");
    cpSync(FIXTURE, dir, { recursive: true });
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    env.spawnClaude = mockSpawnClaude;
    env.mock = true;
    active = [];
    benchHooks.current = () => ({ pack: "light" });
    benchHooks.activate = (_p, c) => {
      active.push(c);
    };
    benchHooks.prepare = async (p: string, ctx: Ctx) => {
      await indexProject(p, ctx);
    };
  });

  afterEach(() => {
    env.spawnClaude = real.spawn;
    env.mock = real.mock;
    Object.assign(benchHooks, real.hooks);
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });

  describe("agentic recall", () => {
    it("is the share of must evidence among the refs Claude opened", () => {
      const resolve = chunkResolver([
        { docId: D3, anchor: "§5.6.6", figureIds: ["40"] },
        { docId: D4, anchor: "§4.2", figureIds: [] },
      ]);
      const must = [`${D3}#§5.6.6`, `${D3}#fig:40`, `${D4}#§4.2`, `${D3}#§5.6.7`];
      expect(agenticRecall(must, [resolve(`${D3}#§5.6.6`)])).toBe(2 / 4);
      expect(agenticRecall(must, [resolve(`${D3}#§5.6.6`), resolve(`${D4}#§ 4.2`)])).toBe(3 / 4);
      expect(agenticRecall(must, [])).toBe(0);
    });

    it("labels a configuration", () => {
      expect(configLabel({ pack: "light" })).toBe("pack:light");
      expect(configLabel({ embedding: "bge-m3", reranker: null })).toBe("bge-m3+none");
    });
  });

  describe("gen.bench on the mock Claude", () => {
    it("runs configurations × behaviors × runs, scores each run, reverts the tests, restores the active choice", async () => {
      const before = readdirSync(join(dir, "tests")).sort();
      const r = (await invoke(
        "gen.bench",
        {
          behaviors: ["sectionneur-sans-tk-menu"],
          configs: [{ pack: "light" }, { embedding: "qwen3-embedding-0.6b", reranker: null }],
          runs: 2,
          check: false,
        },
        { project: dir },
      )) as BenchReport;
      expect(active).toEqual([
        { pack: "light" },
        { embedding: "qwen3-embedding-0.6b", reranker: null },
        { pack: "light" },
      ]);
      expect(r.rows).toHaveLength(4);
      expect(r.rows.map((x) => [x.config, x.run])).toEqual([
        ["pack:light", 1],
        ["pack:light", 2],
        ["qwen3-embedding-0.6b+none", 1],
        ["qwen3-embedding-0.6b+none", 2],
      ]);
      for (const row of r.rows) {
        expect(row).toMatchObject({ ok: true, tests: 2 });
        expect(row.agenticRecall).toBeTypeOf("number");
        expect(row.consulted).not.toBeNull();
        expect(row.quoteErrors).toBe(1);
        expect(row.findings.errors).toBeGreaterThanOrEqual(1);
        expect(row.costUsd).toBeGreaterThan(0);
      }
      expect(r.provisional).toBe(true);
      expect(r.summary).toHaveLength(2);
      expect(r.summary[0]).toMatchObject({ config: "pack:light", runs: 2, failed: 0, tests: 2 });
      expect(r.summary[0].agenticRecall).toBeTypeOf("number");
      expect(readdirSync(join(dir, "tests")).sort()).toEqual(before);
      expect(existsSync(r.report)).toBe(true);
      expect(
        readJson<{ kind: string; config: { runs: number } }>(r.report, { kind: "", config: { runs: 0 } }),
      ).toMatchObject({ kind: "bench", config: { runs: 2 } });
    }, 30000);

    it("reads the consulted refs of the evidence ledger, keeps the tests on request", async () => {
      const off = subscribe((e) => {
        if (e.type !== "status" || e.job.kind !== "generate" || e.job.status !== "done") return;
        const f = join(dir, ".testimus", "gen", `${e.jobId}.json`);
        writeJson(f, { ...readJson<object>(f, {}), consulted: [`${D3}#§5.6.6`, `${D3}#fig:40`] });
      });
      const before = readdirSync(join(dir, "tests")).length;
      const r = (await invoke(
        "gen.bench",
        {
          behaviors: ["sectionneur-sans-tk-menu", "menus-disjoncteur-signal"],
          configs: [{ pack: "light" }],
          runs: 1,
          check: false,
          keep: true,
        },
        { project: dir },
      )) as BenchReport;
      off();
      expect(r.rows.map((x) => [x.behavior, x.agenticRecall, x.consulted])).toEqual([
        ["sectionneur-sans-tk-menu", 1, 2],
        ["menus-disjoncteur-signal", 0, 2],
      ]);
      expect(r.summary[0].agenticRecall).toBe(0.5);
      expect(r.notes.join(" ")).not.toMatch(/no consulted list/);
      expect(readdirSync(join(dir, "tests")).length).toBe(before + 4);
    }, 30000);

    it("records a failed run and goes on; refuses an unknown behavior", async () => {
      env.spawnClaude = async () => {
        throw new Error("spawn failed");
      };
      const r = (await invoke(
        "gen.bench",
        { behaviors: ["tco-deux-rangs"], configs: [{ pack: "light" }], runs: 1, check: false },
        { project: dir },
      )) as BenchReport;
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].ok).toBe(false);
      expect(r.summary[0].failed).toBe(1);
      await expect(
        invoke("gen.bench", { behaviors: ["nope"], configs: [{ pack: "light" }] }, { project: dir }),
      ).rejects.toThrow(/Unknown behavior nope/);
    }, 30000);
  });
});

describe("gen.bench — its hooks, the ledger, fake runs", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
  const real = { mock: env.mock, hooks: { ...benchHooks } };
  let dir: string;
  let calls: { name: string; input: Record<string, unknown> }[];

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "testimus-cov-bench-")), "P");
    cpSync(FIXTURE, dir, { recursive: true });
    env.mock = true;
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
      await benchHooks.prepare(dir, {
        ...quietCtx(dir),
        invoke: (n, i, o) => invoke(n, i, { project: dir, ...o }),
      });
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
    let fake: (name: string, input: unknown) => Promise<unknown>;
    beforeEach(() => {
      fake = async () => ({});
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
      fake = async (name, input) => {
        calls.push({ name, input: input as Record<string, unknown> });
        if (name === "claude.revert") throw "locked";
        const gen = join(dir, ".testimus", "gen");
        mkdirSync(gen, { recursive: true });
        writeJson(join(gen, "run1.json"), { runId: "run1", consulted: ["SOSIE_211_D401-1_3#§5.6.6", 3] });
        return { runId: "run1", generation: "run1", ok: true, tests: ["T-1"], durationMs: 5 };
      };
      const r = await runBench(
        dir,
        { ...quietCtx(dir), invoke: (n, i) => fake(n, i) },
        {
          set: validatedSet(),
          behaviors: ["b1"],
          configs: [{ embedding: "bge-m3", reranker: null }],
          runs: 1,
          model: "opus",
          effort: "low",
        },
      );
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
      fake = async (name) => {
        if (name === "claude.revert") throw new Error("busy");
        if (++n === 1) throw "exploded";
        if (n === 2) throw new Error("gen failed");
        return { runId: "nope", ok: true, tests: ["T-2"], durationMs: 1, costUsd: 0.5 };
      };
      const r = await runBench(
        dir,
        { ...quietCtx(dir), invoke: (n, i) => fake(n, i) },
        {
          set: validatedSet(),
          behaviors: ["b1"],
          configs: [{ pack: "light" }],
          runs: 3,
        },
      );
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
      const r = await runBench(
        dir,
        { ...quietCtx(dir), invoke: (n, i) => fake(n, i) },
        {
          set: validatedSet(),
          behaviors: ["b1"],
          configs: [{ pack: "light" }],
          runs: 0,
        },
      );
      expect(r.summary[0]).toMatchObject({ runs: 0, agenticRecall: null, tests: 0 });
    });

    it("a test kept on request is not reverted; the default set of the project is used", async () => {
      fake = async (name) => {
        calls.push({ name, input: {} });
        return { runId: "r", ok: false, tests: [], durationMs: 1 };
      };
      const r = await runBench(
        dir,
        { ...quietCtx(dir), invoke: (n, i) => fake(n, i) },
        {
          behaviors: ["sectionneur-sans-tk-menu"],
          configs: [{ pack: "light" }],
          runs: 1,
          keep: true,
          check: false,
        },
      );
      expect(calls.map((c) => c.name)).toEqual(["gen.tests"]);
      expect(r.provisional).toBe(true);
    });
  });
});
