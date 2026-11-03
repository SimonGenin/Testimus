import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { activeModels, projectKey, resolveModel, setActiveChoice } from "../../../../src/core/rag/activation.ts";
import { indexFile, nearest, openDb, transaction, vecTable } from "../../../../src/core/rag/db.ts";
import { embedWith, probeWith, rerankerFor, rerankFor, runtimes } from "../../../../src/core/rag/embed.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { mockRuntime } from "../../../../src/core/rag/runtimes/mock.ts";
import { vector } from "../../../../src/core/rag/search/vector.ts";
import type { ResolvedModel } from "../../../../src/core/types.ts";

vi.mock("../../../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/models-resolve.ts")>();
  return {
    ...real,
    resolveInstalled: () => null,
    resolveChoice: async (choice: unknown) => ({
      choice,
      variant: null,
      variantIndex: null,
      embedding: null,
      reranker: null,
      skipped: [],
      missing: [],
    }),
  };
});

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const realMock = env.mock;
const realRuntimes = { ...runtimes, mock: { ...mockRuntime } };
let dir: string;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-cov-rm-")), "P");
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
});

afterEach(() => {
  env.mock = realMock;
  Object.assign(runtimes, realRuntimes);
  runtimes.mock = realRuntimes.mock;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("embed dispatcher", () => {
  const m = (): ResolvedModel => {
    const r = resolveModel("bge-m3-q8", "t");
    if (!r) throw new Error("bge-m3-q8 does not resolve under --mock");
    return r;
  };

  it("a model whose fingerprint cannot be made still embeds, without a space", async () => {
    const base = m();
    const broken = { ...base, entry: { ...base.entry, queryInstruction: undefined } } as unknown as ResolvedModel;
    const [v] = await embedWith(broken, ["hello"], "doc");
    expect(v.length).toBe(base.entry.dims);
    expect((await probeWith(base)).dims).toBe(base.entry.dims);
  });

  it("rerankerFor: none, the active one; rerankFor scores or returns null", async () => {
    const p = readProject(dir);
    writeProject(dir, {
      ...p,
      rag: { ...p.rag, reference: { embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" } },
    });
    expect(await rerankerFor(dir, { reranker: null })).toBeNull();
    expect((await rerankerFor(dir, {}))?.entry.id).toBe(catalogEntry("bge-reranker-v2-m3-q8")?.id);
    expect(await rerankFor(dir, { reranker: null }, "q", ["a"])).toBeNull();
    const r = await rerankFor(dir, {}, "alpha", ["alpha", "beta"]);
    expect(r?.scores).toEqual([1, 0]);
  });
});

describe("vector search", () => {
  it("uses the active model, and degrades when the query cannot be embedded", async () => {
    await indexProject(dir, quietCtx(dir));
    const db = openDb(indexFile(dir));
    try {
      const ok = await vector(db, dir, "sectionneur", {});
      expect(ok.degraded).toBeNull();
      expect(ok.ids.length).toBeGreaterThan(0);
      runtimes.mock = {
        ...mockRuntime,
        embed: async () => {
          throw new Error("model crashed");
        },
      };
      expect((await vector(db, dir, "x", {})).degraded).toMatch(/failed on the query \(model crashed\)/);
      runtimes.mock = {
        ...mockRuntime,
        embed: async () => {
          throw "plain";
        },
      };
      expect((await vector(db, dir, "x", {})).degraded).toMatch(/failed on the query \(plain\)/);
    } finally {
      db.close();
    }
  });
});

describe("activation corners", () => {
  it("an unknown pack is skipped; a reference embedding without reranker resolves", async () => {
    setActiveChoice(dir, { pack: "no-such-pack" });
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, reference: { embedding: "bge-m3-q8", reranker: null } } });
    const a = await activeModels(dir);
    expect(a.missing).toContain("pack no-such-pack");
    expect(a.source).toBe("reference");
    expect(a.reranker).toBeNull();
    writeProject(dir, {
      ...p,
      rag: { ...p.rag, reference: { embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" } },
    });
    expect((await activeModels(dir)).reranker?.entry.id).toBe(catalogEntry("bge-reranker-v2-m3-q8")?.id);
    writeProject(dir, { ...p, rag: { ...p.rag, reference: undefined } });
    expect((await activeModels(dir)).source).toBe("light");
    setActiveChoice(dir, null);
  });

  it("the project key keeps its case outside Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      const k = projectKey(join(dir, "MiXeD"));
      expect(k).toContain("MiXeD");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

describe("db corners", () => {
  it("a failing transaction rolls back; a bad space id and k = 0 are handled", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t (x integer)");
    expect(() =>
      transaction(db, () => {
        db.exec("insert into t values (1)");
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(db.prepare("select count(*) as n from t").get()).toEqual({ n: 0 });
    db.close();
    expect(() => vecTable("Robert'); drop table chunks;--")).toThrow(/Bad space id/);
    const real = openDb(join(dir, "index", "x.db"));
    try {
      expect(nearest(real, "0123456789ab", new Float32Array([1]), 0)).toEqual([]);
    } finally {
      real.close();
    }
  });
});
