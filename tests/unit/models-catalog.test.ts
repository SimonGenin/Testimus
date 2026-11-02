import { describe, expect, it } from "vitest";
import { catalogEntry, SHIPPED } from "../../src/core/lib/models-catalog.ts";

const byId = new Map(SHIPPED.entries.map((e) => [e.id, e]));

describe("models/catalog.json", () => {
  it("has unique ids, known chains and an exact quantization per entry", () => {
    expect(byId.size).toBe(SHIPPED.entries.length);
    for (const e of SHIPPED.entries) {
      expect(e.quantization, e.id).toBeTruthy();
      expect(e.commercialUse, e.id).toBe(true);
      if (e.lighter) expect(byId.get(e.lighter)?.kind, `${e.id}.lighter`).toBe(e.kind);
      if (e.heavier) expect(byId.get(e.heavier)?.kind, `${e.id}.heavier`).toBe(e.kind);
      if (e.source.ollama) expect(e.source.ollama, e.id).toMatch(/:[\w.-]+$/);
    }
  });

  it("pins every file by SHA-256 (LFS) or git blob id, and a revision", () => {
    for (const e of SHIPPED.entries) {
      expect(e.source.hf?.revision, e.id).toMatch(/^[0-9a-f]{40}$/);
      if (e.source.file) expect(e.source.file.sha256, e.id).toMatch(/^[0-9a-f]{64}$/);
      for (const f of e.source.hf?.files ?? [])
        expect(f.sha256, `${e.id} ${f.path}`).toMatch(/^([0-9a-f]{64}|git:[0-9a-f]{40})$/);
      if (e.runtimes.includes("transformers"))
        expect(e.source.hf?.files?.some((f) => f.path.endsWith(".onnx"))).toBe(true);
    }
  });

  it("maps the v1 profile names to catalog entries", () => {
    expect(catalogEntry("bge-m3")?.id).toBe("bge-m3-q8");
    expect(catalogEntry("qwen3-embedding-0.6b")?.id).toBe("qwen3-embedding-0.6b-onnx-q8");
    expect(catalogEntry("bge-reranker-v2-m3")?.id).toBe("bge-reranker-v2-m3-q8");
  });

  it("P8 — every pack resolves without Ollama; Light and Performance need transformers.js alone", () => {
    expect(SHIPPED.packs.map((p) => p.id)).toEqual(["light", "performance", "balanced", "quality"]);
    for (const p of SHIPPED.packs) {
      expect(p.variants.length, p.id).toBeGreaterThan(0);
      for (const v of p.variants) {
        const models = [v.embedding, v.reranker].filter((m): m is string => !!m);
        for (const id of models) {
          const e = byId.get(id);
          expect(e, `${p.id}: ${id} is in the catalog`).toBeDefined();
          if (!e) continue;
          expect(e.kind).toBe(id === v.embedding ? "embedding" : "reranker");
          expect(e.source.hf, `${p.id}: ${id} has a Hugging Face source`).toBeDefined();
          expect(
            e.runtimes.some((r) => r === "transformers" || r === "llamacpp"),
            `${p.id}: ${id} runs without Ollama`,
          ).toBe(true);
          if (p.id === "light" || p.id === "performance")
            expect(e.runtimes, `${p.id}: ${id} runs in transformers.js`).toContain("transformers");
        }
      }
    }
  });
});
