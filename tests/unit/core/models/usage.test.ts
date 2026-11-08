import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_SEARCH } from "../../../../src/core/claude/access.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { find, invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { runtimes } from "../../../../src/core/rag/embed.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { mockRuntime } from "../../../../src/core/rag/runtimes/mock.ts";
import type { RagChoice } from "../../../../src/core/types.ts";
import { callTool } from "../../../../src/faces/mcp.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const realMock = env.mock;
let dir: string;
let reranked: number;

type Usage = {
  id: string;
  who: string;
  words: string;
  embedding: { use: string; model: string | null; label: string | null };
  reranker: { use: string; model: string | null; label: string | null; why: string | null };
};

function reference(choice: RagChoice) {
  const p = readProject(dir);
  writeProject(dir, { ...p, rag: { ...p.rag, reference: choice } });
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-usage-")), "P");
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
  reranked = 0;
  runtimes.mock = {
    ...mockRuntime,
    rerank: async (m, q, texts) => {
      reranked++;
      return mockRuntime.rerank(m, q, texts);
    },
  };
});

afterEach(() => {
  env.mock = realMock;
  runtimes.mock = mockRuntime;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("models.usage: who uses what on this PC", () => {
  it("one line per user of the search, declared beside its code, with the models each really uses here", async () => {
    reference({ embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" });
    const rows = (await invoke("models.usage", {}, { project: dir })) as Usage[];
    expect(rows.map((r) => r.id)).toEqual(["claude", "palette", "tests", "index", "tests-index", "command"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.claude).toMatchObject({
      who: CLAUDE_SEARCH.who,
      words: "always",
      embedding: { use: "uses", model: "bge-m3-q8", label: "BGE-M3 (8-bit, CPU)" },
      reranker: { use: "no", model: null, label: null, why: "not in Claude's loop" },
    });
    expect(by.palette).toMatchObject({
      words: "always",
      embedding: { use: "uses", model: "bge-m3-q8" },
      reranker: { use: "uses", model: "bge-reranker-v2-m3-q8", label: "BGE Reranker v2 M3 (8-bit, CPU)", why: null },
    });
    expect(by.tests.reranker).toMatchObject({ use: "no", model: null, why: "tests are ranked by meaning alone" });
    expect(by.index).toMatchObject({ words: "builds", embedding: { use: "builds", model: "bge-m3-q8" } });
    expect(by["tests-index"]).toMatchObject({ words: "no", embedding: { use: "builds" }, reranker: { use: "no" } });
    expect(by.command.reranker).toMatchObject({ use: "uses", model: "bge-reranker-v2-m3-q8" });
  });

  it("models the choice does not have are none, never another pack's", async () => {
    reference({ embedding: "bge-m3-q8", reranker: null });
    const rows = (await invoke("models.usage", {}, { project: dir })) as Usage[];
    for (const r of rows) expect(r.reranker.model).toBeNull();
    expect(rows.find((r) => r.id === "palette")?.reranker).toMatchObject({ use: "uses", model: null });
  });
});

describe("the reranker is never in Claude's loop", () => {
  it("rag.search through the MCP face ranks without it; the same search from the command line reranks", async () => {
    reference({ embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" });
    await indexProject(dir, quietCtx(dir));
    const ctx = { mcpReq: { signal: new AbortController().signal, notify: async () => {} } };
    const viaMcp = await callTool(find("rag.search"), dir, { query: "sectionneur" }, ctx);
    expect((viaMcp as unknown[]).length).toBeGreaterThan(0);
    expect(reranked).toBe(0);
    await invoke("rag.search", { query: "sectionneur" }, { project: dir });
    expect(reranked).toBe(1);
  });

  it("search.all through the MCP face ranks its passages without it; from the command line it reranks", async () => {
    reference({ embedding: "bge-m3-q8", reranker: "bge-reranker-v2-m3-q8" });
    await indexProject(dir, quietCtx(dir));
    const ctx = { mcpReq: { signal: new AbortController().signal, notify: async () => {} } };
    const viaMcp = (await callTool(find("search.all"), dir, { query: "sectionneur", in: ["passage"] }, ctx)) as {
      hits: unknown[];
    };
    expect(viaMcp.hits.length).toBeGreaterThan(0);
    expect(reranked).toBe(0);
    await invoke("search.all", { query: "sectionneur", in: ["passage"] }, { project: dir });
    expect(reranked).toBe(1);
  });
});
