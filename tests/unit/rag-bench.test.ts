import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { env } from "../../src/core/env.ts";
import { subscribe } from "../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, readJson, writeJson, writeSettings } from "../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../src/core/mock/claude.ts";
import "../../src/core/mock/claude-check.ts";
import "../../src/core/mock/claude-gen.ts";
import { agenticRecall, type BenchReport, benchHooks, configLabel } from "../../src/core/rag/bench.ts";
import { chunkResolver } from "../../src/core/rag/eval-score.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import type { ActiveChoice, RagChoice } from "../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
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
