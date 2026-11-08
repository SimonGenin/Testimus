import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { indexAfterConversions } from "../../../../src/core/lib/docs-index.ts";
import { BUILDING, modelDeps } from "../../../../src/core/lib/doctor-models.ts";
import { resolveModel } from "../../../../src/core/rag/activation.ts";
import type { DescribeChunks } from "../../../../src/core/rag/chunk.ts";
import { runtimes } from "../../../../src/core/rag/embed.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { mockRuntime } from "../../../../src/core/rag/runtimes/mock.ts";
import type { DocRef } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";
const saved = { ...runtimes };
let dir = "";

function gate() {
  let open = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  let reached = () => {};
  const at = new Promise<void>((r) => {
    reached = r;
  });
  return { open, opened, at, reached };
}

const list = async () => (await invoke("docs.list", {}, { project: dir })) as DocRef[];
const byId = async () => Object.fromEntries((await list()).map((d) => [d.id, d]));
const status = async () =>
  (await invoke("rag.status", {}, { project: dir })) as { degraded: string | null; indexing: unknown };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-index-live-"));
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
});
afterEach(() => {
  env.mock = false;
  Object.assign(runtimes, saved);
  rmSync(dir, { recursive: true, force: true });
});

describe("an index run under way, as docs.list and rag.status say it", () => {
  it("names the document it reads and those waiting while it cuts them, and nothing once it ends", async () => {
    const g = gate();
    const describe: DescribeChunks = async (doc, chunks) => {
      if (doc.id === D3) {
        g.reached();
        await g.opened;
      }
      return chunks.map((c) => c.header);
    };
    expect((await list()).every((d) => d.indexed === "missing" && !d.indexing)).toBe(true);
    expect((await status()).indexing).toBeNull();
    const run = indexAfterConversions(dir, () => indexProject(dir, quietCtx(dir), { model: null, describe }));
    await g.at;
    const now = await byId();
    expect(now[D3].indexed).toBe("missing");
    expect(now[D3].indexing).toEqual({ state: "running", percent: 0, done: 0, total: 0 });
    expect(now[D4].indexing).toEqual({ state: "waiting", percent: 0, done: 0, total: 0 });
    expect((await status()).indexing).toEqual({ state: "running", doc: 1, docs: 2, done: 0, total: 0 });
    g.open();
    await run;
    const after = await list();
    expect(after.map((d) => d.indexed)).not.toContain("missing");
    expect(after.every((d) => d.indexing === undefined)).toBe(true);
    expect((await status()).indexing).toBeNull();
  });

  it("says how far each document got while the passages are embedded; search says it is the run's work", async () => {
    await indexProject(dir, quietCtx(dir), { model: null });
    const g = gate();
    runtimes.mock = {
      ...mockRuntime,
      embed: async (m, texts, mode) => {
        if (mode === "doc") {
          g.reached();
          await g.opened;
        }
        return mockRuntime.embed(m, texts, mode);
      },
    };
    const model = resolveModel("bge-m3-q8");
    const run = indexAfterConversions(dir, () => indexProject(dir, quietCtx(dir), { model }));
    const asked = indexAfterConversions(dir, async () => {
      throw new Error("a run asked for meanwhile shares the next one");
    });
    await g.at;
    const now = await byId();
    expect(now[D3].indexing).toMatchObject({ state: "running", percent: 0, done: 0 });
    expect(now[D3].indexing?.total).toBeGreaterThan(0);
    expect(now[D4].indexing).toMatchObject({ state: "waiting", done: 0 });
    const st = (await status()) as { indexing: { state: string; docs: number; done: number; total: number } };
    expect(st.indexing).toMatchObject({ state: "running", doc: 1, docs: 2, done: 0 });
    expect(st.indexing.total).toBe((now[D3].indexing?.total ?? 0) + (now[D4].indexing?.total ?? 0));

    const logs: [string, string][] = [];
    const hits = (await invoke(
      "rag.search",
      { query: "sectionneur" },
      { project: dir, onLog: (level, m) => logs.push([level, m]) },
    )) as { degraded?: boolean }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.degraded)).toBe(true);
    expect(logs).toEqual([["info", "An index run is under way: search matches words until it ends."]]);
    expect(await modelDeps.space(dir)).toBe(BUILDING);

    g.open();
    await run;
    await asked.catch(() => {});
    expect((await list()).every((d) => !d.indexing)).toBe(true);
    expect((await status()).indexing).toBeNull();
  });
});
