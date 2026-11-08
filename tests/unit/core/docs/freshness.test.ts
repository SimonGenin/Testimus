import { describe, expect, it, vi } from "vitest";
import { docsFreshness } from "../../../../src/core/lib/docs-index.ts";
import { markIndexedInDb } from "../../helpers/index-state.ts";
import { fixtureCopy } from "../registry.ts";

const space = { complete: false };
vi.mock("../../../../src/core/rag/activation.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/core/rag/activation.ts")>()),
  activeModels: vi.fn(async () => ({
    embedding: { entry: { id: "m" } },
    reranker: null,
    missing: [],
    source: "light",
  })),
}));
vi.mock("../../../../src/core/rag/fingerprint.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/core/rag/fingerprint.ts")>()),
  spaceOf: vi.fn(() => space),
}));

describe("the one rule of index freshness", () => {
  it("is stale while the active model's vectors are incomplete, fresh once they are, missing until indexed", async () => {
    const P = fixtureCopy("fresh");
    const others = ["missing", "missing", "missing"];
    expect((await docsFreshness(P)).map((d) => d.indexed)).toEqual([...others, "missing", "missing"]);
    markIndexedInDb(P, ["SOSIE_211_D401-1_3"]);
    expect((await docsFreshness(P)).map((d) => d.indexed)).toEqual([...others, "stale", "missing"]);
    space.complete = true;
    expect((await docsFreshness(P)).map((d) => d.indexed)).toEqual([...others, "fresh", "missing"]);
  });
});
