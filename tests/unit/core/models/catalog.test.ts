import { describe, expect, it } from "vitest";
import { SHIPPED } from "../../../../src/core/lib/models-catalog.ts";

const byId = new Map(SHIPPED.entries.map((e) => [e.id, e]));

describe("models/catalog.json", () => {
  it("has unique ids, known chains and an exact quantization per entry", () => {
    expect(byId.size).toBe(SHIPPED.entries.length);
    for (const e of SHIPPED.entries) {
      expect(e.quantization, e.id).toBeTruthy();
      expect(e.commercialUse, e.id).toBe(true);
      if (e.lighter) expect(byId.get(e.lighter)?.kind, `${e.id}.lighter`).toBe(e.kind);
      if (e.heavier) expect(byId.get(e.heavier)?.kind, `${e.id}.heavier`).toBe(e.kind);
      expect(Object.keys(e.source).sort(), e.id).toEqual(e.source.file ? ["file", "hf"] : ["hf"]);
      expect(
        e.runtimes.every((r) => r === "transformers" || r === "llamacpp" || r === "whispercpp"),
        e.id,
      ).toBe(true);
      expect(
        e.runtimes.includes("whispercpp"),
        `${e.id}: whisper.cpp runs the transcription models, and only them`,
      ).toBe(e.kind === "speech");
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

  it("the transcription models, best first: each 5-bit file beside its 8-bit one, same repository and revision, smaller", () => {
    const speech = SHIPPED.entries.filter((e) => e.kind === "speech");
    expect(speech.map((e) => e.id)).toEqual([
      "whisper-large-v3-turbo-q8",
      "whisper-large-v3-turbo-q5",
      "whisper-small-q8",
      "whisper-small-q5",
    ]);
    for (const light of speech.filter((e) => e.quantization === "q5")) {
      const heavy = byId.get(light.id.replace(/-q5$/, "-q8"));
      expect(heavy?.quantization, light.id).toBe("q8");
      expect(light.source.hf?.repo, light.id).toBe(heavy?.source.hf?.repo);
      expect(light.source.hf?.revision, light.id).toBe(heavy?.source.hf?.revision);
      expect(light.source.hf?.path, light.id).toMatch(/-q5_\d\.bin$/);
      expect(light.source.file?.size, light.id).toBeLessThan(heavy?.source.file?.size ?? 0);
      expect(light.size.downloadMB, light.id).toBe(Math.round((light.source.file?.size ?? 0) / 1024 / 1024));
    }
  });

  it("P8 — every pack resolves with transformers.js and llama.cpp; Light and Performance with transformers.js alone", () => {
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
            `${p.id}: ${id} runs in transformers.js or llama.cpp`,
          ).toBe(true);
          if (p.id === "light" || p.id === "performance")
            expect(e.runtimes, `${p.id}: ${id} runs in transformers.js`).toContain("transformers");
        }
      }
    }
  });
});
