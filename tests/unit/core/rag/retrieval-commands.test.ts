import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { RETRIEVAL_DEFAULTS } from "../../../../src/core/rag/search/hybrid.ts";
import { call, fixtureCopy } from "../registry.ts";

type Settings = CommandOutput<"rag.retrieval">;
type Measure = CommandOutput<"rag.measure">;

let dir: string;
const realMock = env.mock;

beforeEach(() => {
  dir = fixtureCopy("retrieval-commands");
  env.mock = true;
});

afterEach(() => {
  env.mock = realMock;
  rmSync(dir, { recursive: true, force: true });
});

const saved = () => JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).rag.retrieval;

describe("rag.retrieval and rag.setRetrieval", () => {
  it("reads the defaults, the project's settings and what a search runs with", async () => {
    const s = await call<Settings>("rag.retrieval", {}, dir);
    expect(s.defaults).toEqual(RETRIEVAL_DEFAULTS);
    expect(s.project).toBeNull();
    expect(s.base).toEqual({ ...RETRIEVAL_DEFAULTS, ...(s.pack ?? {}) });
    expect(s.effective).toEqual(s.base);
    expect(s.glossary).toEqual({ documents: expect.any(Number), project: 0 });
  });

  it("writes the keys given over project.json rag.retrieval, takes out the unset ones, keeps the others", async () => {
    await call(
      "project.set",
      { rag: { retrieval: { candidates: 80, rrfK: 20, rerank: { top: 40, mode: "topk" }, typos: true } } },
      dir,
    );
    await call(
      "rag.setRetrieval",
      { retrieval: { synonyms: [["TK", "télécommande"]], rerank: { mode: "threshold" } }, unset: ["rrfK"] },
      dir,
    );
    expect(saved()).toEqual({
      candidates: 80,
      rerank: { top: 40, mode: "threshold" },
      typos: true,
      synonyms: [["TK", "télécommande"]],
    });
    await call("rag.setRetrieval", { retrieval: {}, unset: ["candidates", "rerank", "typos", "synonyms"] }, dir);
    expect(saved()).toBeUndefined();
  });

  it("tidies the synonyms, and resets with null", async () => {
    await call("project.set", { rag: { retrieval: { rrfK: 20, candidates: 70 } } }, dir);
    const s = await call<Settings>(
      "rag.setRetrieval",
      {
        retrieval: {
          candidates: 80,
          rrfWeights: [2, 1],
          typos: true,
          synonyms: [
            [" TK ", "télécommande", "TK"],
            ["seul", "seul "],
          ],
        },
      },
      dir,
    );
    expect(saved()).toEqual({
      rrfK: 20,
      candidates: 80,
      rrfWeights: [2, 1],
      typos: true,
      synonyms: [["TK", "télécommande"]],
    });
    expect(s.project).toEqual(saved());
    expect(s.effective).toMatchObject({ candidates: 80, rrfK: 20, rrfWeights: [2, 1], typos: true });
    const reset = await call<Settings>("rag.setRetrieval", { retrieval: null }, dir);
    expect(saved()).toBeUndefined();
    expect(reset.project).toBeNull();
    await call("rag.setRetrieval", { retrieval: {} }, dir);
    expect(saved()).toBeUndefined();
  });

  it("refuses settings zod does not accept", async () => {
    await expect(call("rag.setRetrieval", { retrieval: { rrfWeights: [1] } }, dir)).rejects.toThrow();
    await expect(call("rag.setRetrieval", { retrieval: { synonyms: [["seul"]] } }, dir)).rejects.toThrow();
    await expect(call("rag.setRetrieval", { retrieval: { candidates: 0 } }, dir)).rejects.toThrow();
  });
});

describe("rag.measure", () => {
  it("measures the saved settings and the tried ones on the benchmark and compares them", async () => {
    const m = await call<Measure>(
      "rag.measure",
      { retrieval: { candidates: 1, bm25Weights: [1, 1, 1] }, mode: "bm25" },
      dir,
      { wait: true },
    );
    expect(m.baseline.setting).toMatch(/-bm25$/);
    expect(m.candidate.setting).toBe(`${m.baseline.setting}-r${m.candidate.setting.slice(-6)}`);
    expect(m.baseline.report).not.toBe(m.candidate.report);
    expect(m).toMatchObject({ k: 10, policy: "search", provisional: true, n: 5 });
    expect(m.diff).toBeCloseTo(m.candidate.recall - m.baseline.recall);
    expect(m.adopt).toBe(false);
    expect(m.why).toContain("Provisional");
    expect(saved()).toBeUndefined();
  });
});
