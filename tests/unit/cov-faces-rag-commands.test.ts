import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Command, quietCtx } from "../../src/core/command.ts";
import { commands as claudeCommands } from "../../src/core/commands/claude.ts";
import { commands as ragIndexCommands } from "../../src/core/commands/rag-index.ts";
import { env } from "../../src/core/env.ts";
import { catalogEntry } from "../../src/core/lib/models-catalog.ts";
import { mockSpawnClaude } from "../../src/core/mock/claude.ts";
import { createSpace, indexFile, openDb, spaceId } from "../../src/core/rag/db.ts";
import { fingerprintOf } from "../../src/core/rag/fingerprint.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import type { ResolvedModel, SpaceFingerprint } from "../../src/core/types.ts";
import { copyFixture, tempRoot } from "./cov-faces-helpers.ts";
import "../../src/core/commands/index.ts";

const active = vi.hoisted(() => ({ embedding: null as unknown }));

vi.mock("../../src/core/rag/activation.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  activeModels: async () => ({
    embedding: active.embedding,
    reranker: null,
    choice: null,
    source: "none",
    missing: ["bge-m3"],
  }),
}));

function fakeModel(): ResolvedModel {
  const entry = catalogEntry("bge-m3-q8");
  if (!entry) throw new Error("no bge-m3-q8 in the catalog");
  const runtime = entry.runtimes[0];
  const dtype = entry.dtypeByDevice?.cpu;
  return {
    entry,
    install: { model: entry.id, via: "path", runtime, path: "D:/models/x", dtype, status: "installed" },
    runtime,
    device: "cpu",
    dtype,
    queryTask: "q",
  } as ResolvedModel;
}

function withIndex(work: (db: ReturnType<typeof openDb>) => void): void {
  const db = openDb(indexFile(project));
  try {
    work(db);
  } finally {
    db.close();
  }
}

const all: Command[] = [...ragIndexCommands, ...claudeCommands];
const cmd = (name: string) => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = cmd(name);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};

let project = "";
beforeEach(() => {
  project = copyFixture(tempRoot("ragcmd"));
  active.embedding = null;
});

describe("rag index commands without an embedding model", () => {
  it("say there is no index yet", async () => {
    await expect(run("rag.dropSpace", { id: "abcd" })).rejects.toThrow("The project has no index yet.");
    expect(await run("rag.spaces")).toEqual([]);
    const st = await run("rag.status");
    expect(st).toMatchObject({ embedding: "none", reranker: null, dims: 0, exists: false, chunks: 0, builtAt: null });
    expect(st.missing).toEqual(["bge-m3"]);
    expect(st.degraded).toBeTruthy();
    expect(st.docs.every((d: { indexed: string }) => d.indexed === "missing")).toBe(true);
  });

  it("report a BM25-only index as fresh, with no active vector space", async () => {
    await indexProject(project, quietCtx(project), { model: null });
    const st = await run("rag.status");
    expect(st.exists).toBe(true);
    expect(st.chunks).toBeGreaterThan(0);
    expect(st.docs.every((d: { indexed: string }) => d.indexed === "fresh")).toBe(true);
    expect(await run("rag.spaces")).toEqual([]);
    await expect(run("rag.dropSpace", { id: "abcd" })).rejects.toThrow("No vector space abcd in the index.");
    const file = join(project, "docs", "SOSIE_211_D401-1_4", "doc.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}\nReconverti.\n`);
    const after = await run("rag.status");
    expect(after.docs.find((d: { docId: string }) => d.docId === "SOSIE_211_D401-1_4").indexed).toBe("stale");
  });
});

describe("rag index commands with hand-built spaces", () => {
  it("says the active space is incomplete", async () => {
    await indexProject(project, quietCtx(project), { model: null });
    const m = fakeModel();
    withIndex((db) => createSpace(db, fingerprintOf(m)));
    active.embedding = m;
    const st = await run("rag.status");
    expect(st.space).toMatchObject({ vectors: 0, complete: false });
    expect(st.profileMatches).toBe(false);
    expect(st.degraded).toBe(`The vectors of ${m.entry.id} are incomplete: run rag index.`);
    expect(st.docs.every((d: { indexed: string }) => d.indexed === "stale")).toBe(true);
    const spaces = await run("rag.spaces");
    expect(spaces).toHaveLength(1);
    expect(spaces[0].active).toBe(true);
  });

  it("refuses a prefix that matches several spaces", async () => {
    await indexProject(project, quietCtx(project), { model: null });
    const base = fingerprintOf(fakeModel());
    const seen = new Map<string, SpaceFingerprint>();
    let pair: SpaceFingerprint[] = [];
    for (let i = 0; i < 100000 && !pair.length; i++) {
      const fp = { ...base, model: `test-${i}`, dims: 8 };
      const prefix = spaceId(fp).slice(0, 4);
      const other = seen.get(prefix);
      if (other) pair = [other, fp];
      else seen.set(prefix, fp);
    }
    withIndex((db) => {
      for (const fp of pair) createSpace(db, fp);
    });
    const prefix = spaceId(pair[0]).slice(0, 4);
    await expect(run("rag.dropSpace", { id: prefix })).rejects.toThrow(`${prefix} matches 2 spaces.`);
  });
});

describe("claude.run subject", () => {
  it("names the scope of the run", () => {
    const c = cmd("claude.run");
    const subject = (scope: unknown) => c.subject?.(c.input.parse({ prompt: "p", scope }) as never);
    expect(subject({ kind: "tests", testIds: ["a", "b"] })).toBe("2 tests");
    expect(subject({ kind: "project" })).toBe("project");
    expect(subject({ kind: "test", testId: "local-1" })).toBe("local-1");
    expect(subject({ kind: "step", testId: "local-1", step: 2 })).toBe("local-1 step 2");
  });
});

describe("claude.run on the whole project", () => {
  it("runs with the project's contexts", async () => {
    const real = env.spawnClaude;
    env.spawnClaude = mockSpawnClaude;
    try {
      const r = await run("claude.run", { scope: { kind: "project" }, prompt: "Relis." });
      expect(r).toHaveProperty("ok");
      expect(r).toHaveProperty("runId");
    } finally {
      env.spawnClaude = real;
    }
  });
});
