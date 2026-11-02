import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { env } from "../../src/core/env.ts";
import { catalogEntry } from "../../src/core/lib/models-catalog.ts";
import { readProject, writeProject } from "../../src/core/lib/project.ts";
import { activeModels, projectKey, setActiveChoice } from "../../src/core/rag/activation.ts";
import { indexFile, nearest, openDb, transaction, vecTable } from "../../src/core/rag/db.ts";
import { embedWith, probeWith, rerankerFor, rerankFor, runtimes } from "../../src/core/rag/embed.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import {
  catalogIdOf,
  embeddingProfile,
  findProfile,
  modelForProfile,
  profileFingerprint,
  RERANKERS,
  rerankerProfile,
} from "../../src/core/rag/models.ts";
import { mockRuntime } from "../../src/core/rag/runtimes/mock.ts";
import { vector } from "../../src/core/rag/search/vector.ts";
import type { ModelProfile, ResolvedModel } from "../../src/core/types.ts";

vi.mock("../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/lib/models-resolve.ts")>();
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

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
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

const fakeProfile = (name: string): ModelProfile => ({ ...RERANKERS[0], name });

describe("v1 model profiles", () => {
  it("finds, refuses and fingerprints profiles", () => {
    expect(findProfile("bge-m3")?.dims).toBe(1024);
    expect(findProfile("nope")).toBeUndefined();
    expect(rerankerProfile("bge-reranker-v2-m3").dims).toBe(1);
    expect(() => rerankerProfile("nope")).toThrow(/Unknown reranker profile "nope"/);
    expect(() => embeddingProfile("nope")).toThrow(/Unknown embedding profile/);
    expect(profileFingerprint(embeddingProfile("bge-m3"))).toMatchObject({
      runtime: "transformers",
      model: "profile:Xenova/bge-m3:q8",
      modelId: "bge-m3",
      dims: 1024,
      maxInputTokens: 8192,
    });
  });

  it("maps a profile to its catalog model; refuses one unknown or not installed", () => {
    expect(catalogIdOf(embeddingProfile("bge-m3"))).toBe(catalogEntry("bge-m3")?.id);
    expect(() => catalogIdOf(fakeProfile("nope"))).toThrow(/has no catalog entry/);
    expect(modelForProfile(embeddingProfile("bge-m3"), "task").queryTask).toBe("task");
    env.mock = false;
    expect(() => modelForProfile(embeddingProfile("bge-m3"), "task")).toThrow(/bge-m3 is not installed on this PC/);
  });
});

describe("embed dispatcher", () => {
  const m = (): ResolvedModel => {
    const r = modelForProfile(embeddingProfile("bge-m3"), "t");
    return r;
  };

  it("a model whose fingerprint cannot be made still embeds, without a space", async () => {
    const base = m();
    const broken = { ...base, entry: { ...base.entry, queryInstruction: undefined } } as unknown as ResolvedModel;
    const [v] = await embedWith(broken, ["hello"], "doc");
    expect(v.length).toBe(base.entry.dims);
    expect((await probeWith(base)).dims).toBe(base.entry.dims);
  });

  it("rerankerFor: none, a profile, the active one; rerankFor scores or returns null", async () => {
    expect(await rerankerFor(dir, { reranker: null })).toBeNull();
    expect((await rerankerFor(dir, { reranker: rerankerProfile("bge-reranker-v2-m3") }))?.entry.id).toBe(
      catalogEntry("bge-reranker-v2-m3")?.id,
    );
    expect(await rerankFor(dir, { reranker: null }, "q", ["a"])).toBeNull();
    const r = await rerankFor(dir, { reranker: rerankerProfile("bge-reranker-v2-m3") }, "alpha", ["alpha", "beta"]);
    expect(r?.scores).toEqual([1, 0]);
  });
});

describe("vector search", () => {
  it("uses a given profile, and degrades when the query cannot be embedded", async () => {
    await indexProject(dir, quietCtx(dir));
    const db = openDb(indexFile(dir));
    try {
      const ok = await vector(db, dir, "sectionneur", { profile: embeddingProfile("bge-m3") });
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
  it("an unknown pack is skipped; a project embedding without reranker resolves", async () => {
    setActiveChoice(dir, { pack: "no-such-pack" });
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, reference: undefined, embedding: "bge-m3", reranker: null } });
    const a = await activeModels(dir);
    expect(a.missing).toContain("pack no-such-pack");
    expect(a.source).toBe("project");
    expect(a.reranker).toBeNull();
    writeProject(dir, {
      ...p,
      rag: { ...p.rag, reference: undefined, embedding: "bge-m3", reranker: "bge-reranker-v2-m3" },
    });
    expect((await activeModels(dir)).reranker?.entry.id).toBe(catalogEntry("bge-reranker-v2-m3")?.id);
    writeProject(dir, { ...p, rag: { ...p.rag, reference: undefined, embedding: "" } });
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

  it("a v1 index without its dims meta only drops the old vector table", () => {
    const file = join(dir, "index", "legacy.db");
    const first = openDb(file);
    first.exec("create table vecs (chunk_rowid integer primary key, embedding blob)");
    first.close();
    const db = openDb(file);
    try {
      expect(db.prepare("select 1 from sqlite_master where name = 'vecs'").get()).toBeUndefined();
      expect(db.prepare("select count(*) as n from spaces").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});
