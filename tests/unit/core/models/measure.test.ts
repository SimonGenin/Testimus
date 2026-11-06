import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { SHIPPED } from "../../../../src/core/lib/models-catalog.ts";
import { packRows } from "../../../../src/core/lib/models-packs.ts";
import {
  evalReports,
  NOT_MEASURED,
  refdocQuality,
  refdocScore,
  refdocText,
} from "../../../../src/core/lib/models-quality.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import { parseSections } from "../../../../src/core/rag/chunk.ts";
import type { EvalReport } from "../../../../src/core/rag/eval.ts";
import { readBehaviors } from "../../../../src/core/rag/eval-set.ts";
import { measureRefdoc, publishedMeasure, REFDOC, refdocDir, refdocSource } from "../../../../src/core/rag/refdoc.ts";
import type { PackMeasure } from "../../../../src/core/types.ts";
import { call } from "../registry.ts";

const realMock = env.mock;

beforeEach(() => {
  env.mock = true;
  pinMachineProfile(mockMachine("dev"));
});

afterEach(() => {
  env.mock = realMock;
  pinMachineProfile(null);
});

const report = (ranks: (number | null)[], over: Partial<EvalReport["config"]> = {}): EvalReport =>
  ({
    config: { embedding: "e", reranker: null, mode: "hybrid", ...over },
    setting: "e-hybrid",
    policies: [],
    behaviors: ranks.map((rank, i) => ({ id: `q${i}`, policies: { search: { rank } } })),
  }) as unknown as EvalReport;

describe("the reference document", () => {
  it("ships the Syntec agreement and its 100 validated questions, each answered by an article of the document", () => {
    const dir = refdocSource();
    const md = readFileSync(join(dir, "docs", REFDOC.id, "doc.md"), "utf8");
    const anchors = new Set(parseSections(md).map((s) => s.anchor));
    expect(anchors.size).toBe(REFDOC.articles);
    const set = readBehaviors(join(dir, "eval", "behaviors.jsonl"));
    expect(set.behaviors).toHaveLength(REFDOC.questions);
    expect(set.behaviors.every((b) => b.validated === true)).toBe(true);
    for (const b of set.behaviors)
      for (const e of b.evidence) expect(anchors.has(e.ref.replace(`${REFDOC.id}#`, ""))).toBe(true);
  });

  it("scores where search ranks the answering article: first, and in the top 5", () => {
    expect(refdocScore(report([1, 2, 6, null]))).toEqual({ first: 0.25, top5: 0.5, questions: 4 });
    expect(refdocScore(report([]))).toBeNull();
    expect(refdocText({ first: 0.6, top5: 0.91, questions: 100 }, "this PC")).toBe(
      "right article first for 60 % of the 100 reference questions, in the top 5 for 91 % (measured by this PC)",
    );
  });

  it("a pack's quality: measured on this PC first, else the catalog's figure, else not measured", () => {
    const local = [{ file: "a.json", report: report([1, 1, 3, 9]), mtime: 1 }];
    const published: PackMeasure = {
      embedding: "e",
      reranker: null,
      first: 0.7,
      top5: 0.9,
      questions: 100,
      app: "0.1.0",
      date: "2026-11-03",
    };
    expect(refdocQuality({ embedding: "e", reranker: null }, local, published)).toEqual({
      text: "right article first for 50 % of the 4 reference questions, in the top 5 for 75 % (measured by this PC)",
      here: true,
    });
    expect(refdocQuality({ embedding: "e", reranker: "r" }, local, published)).toEqual({
      text: "right article first for 70 % of the 100 reference questions, in the top 5 for 90 % (measured by Testimus)",
      here: false,
    });
    expect(refdocQuality({ embedding: "e", reranker: "r" }, local, null)).toEqual({ text: NOT_MEASURED, here: false });
  });

  it("the catalog's figures are found by pack and pair", () => {
    const withFigure = SHIPPED.packs.flatMap((p) => (p.measured ?? []).map((m) => [p.id, m] as const));
    for (const [id, m] of withFigure) expect(publishedMeasure(id, m.embedding, m.reranker)).toEqual(m);
    expect(publishedMeasure("light", "nope", null)).toBeNull();
    expect(publishedMeasure("nope", "bge-m3-q8", null)).toBeNull();
  });

  it("measures a pack on this PC's copy of the document, without a project, and the pack card shows it", async () => {
    const r = await measureRefdoc(quietCtx(null), { pack: "light" });
    expect(r.config.embedding).toBe("bge-m3-q8");
    expect(r.config.set.behaviors).toBe(REFDOC.questions);
    expect(r.report.startsWith(join(refdocDir(), ".testimus", "eval"))).toBe(true);
    expect(existsSync(join(refdocDir(), "docs", REFDOC.id, "doc.md"))).toBe(true);
    const rows = await packRows(null);
    const light = rows.find((p) => p.id === "light");
    expect(light?.measuredHere).toBe(true);
    expect(light?.quality).toMatch(/^right article first for .* \(measured by this PC\)$/);
    expect(light?.projectQuality).toBeUndefined();
    expect(evalReports(refdocDir()).length).toBeGreaterThan(0);
  }, 120_000);

  it("models.measure: a job on a pack or a pair; says what to measure when given neither", async () => {
    const out = await call<{ embedding: string; questions: number; quality: string }>(
      "models.measure",
      { pack: "light" },
      null,
    );
    expect(out.embedding).toBe("bge-m3-q8");
    expect(out.questions).toBe(REFDOC.questions);
    expect(out.quality).toMatch(/measured by this PC/);
    await expect(invoke("models.measure", {}, { project: null })).rejects.toThrow("Say what to measure.");
    await expect(invoke("models.measure", { pack: "nope" }, { project: null })).rejects.toThrow();
  }, 120_000);
});
