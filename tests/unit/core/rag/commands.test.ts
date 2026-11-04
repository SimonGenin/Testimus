import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserError } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { whileConverting } from "../../../../src/core/lib/docs-index.ts";
import { call, fixtureCopy } from "../registry.ts";

const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";
let dir: string;
const realMock = env.mock;

beforeEach(() => {
  dir = fixtureCopy("rag-commands");
  env.mock = true;
});

afterEach(() => {
  env.mock = realMock;
  rmSync(dir, { recursive: true, force: true });
});

type Index = { embedding: string; space?: string; docs: { docId: string; status: string }[]; chunks: number };

describe("rag commands through the registry, each output checked against its schema", () => {
  it("rag.index builds the index, rag.status and rag.spaces describe it", async () => {
    const before = await call<{ exists: boolean; docs: { indexed: string }[] }>("rag.status", {}, dir);
    expect(before.exists).toBe(false);
    expect(before.docs.map((d) => d.indexed)).toEqual(["missing", "missing"]);
    const r = await call<Index>("rag.index", {}, dir);
    expect(r.docs.map((d) => [d.docId, d.status])).toEqual([
      [D3, "indexed"],
      [D4, "indexed"],
    ]);
    expect(r.chunks).toBeGreaterThan(0);
    const again = await call<Index>("rag.index", {}, dir);
    expect(again.docs.map((d) => d.status)).toEqual(["unchanged", "unchanged"]);
    const status = await call<{ exists: boolean; profileMatches: boolean; docs: { indexed: string }[] }>(
      "rag.status",
      {},
      dir,
    );
    expect(status).toMatchObject({ exists: true, profileMatches: true });
    expect(status.docs.map((d) => d.indexed)).toEqual(["fresh", "fresh"]);
    const spaces = await call<{ id: string; active: boolean; complete: boolean }[]>("rag.spaces", {}, dir);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({ id: r.space, active: true, complete: true });
  });

  it("rag.index waits for a conversion writing a document, and says so", async () => {
    let finish = () => {};
    const converting = whileConverting(dir, () => new Promise<void>((ok) => (finish = ok)));
    let done = false;
    const run = call<Index>("rag.index", {}, dir).then((r) => {
      done = true;
      return r;
    });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(done).toBe(false);
    const running = await call<{ kind: string; message?: string }[]>("jobs.list", { running: true }, dir);
    expect(running.find((j) => j.kind === "rag-index")?.message).toBe("Waiting for the other conversions");
    finish();
    await converting;
    expect((await run).chunks).toBeGreaterThan(0);
  });

  it("rag.dropSpace refuses the active space without force, then drops it", async () => {
    await expect(call("rag.dropSpace", { id: "abcd" }, dir)).rejects.toThrow(/no index yet/);
    const r = await call<Index>("rag.index", {}, dir);
    const id = r.space as string;
    await expect(call("rag.dropSpace", { id: id.slice(0, 6) }, dir)).rejects.toThrow(UserError);
    const out = await call<{ dropped: string }>("rag.dropSpace", { id: id.slice(0, 6), force: true }, dir);
    expect(out.dropped).toBe(id);
    expect(await call("rag.spaces", {}, dir)).toEqual([]);
  });

  it("rag.search, rag.passage and rag.figure read the documents", async () => {
    await call("rag.index", {}, dir);
    const hits = await call<{ docId: string; anchor: string }[]>("rag.search", { query: "sectionneur" }, dir);
    expect(hits.some((h) => h.docId === D3 && h.anchor === "§5.6.6")).toBe(true);
    const bm25 = await call<unknown[]>("rag.search", { query: "sectionneur", mode: "bm25", k: 2 }, dir);
    expect(bm25.length).toBeLessThanOrEqual(2);
    const p = await call<{ anchor: string; title: string; figures: unknown[] }>(
      "rag.passage",
      { ref: `${D3}#§5.6.6` },
      dir,
    );
    expect(p.anchor).toBe("§5.6.6");
    expect(p.figures).toHaveLength(1);
    const f = await call<{ anchor: string; picture: boolean; exists: boolean }>(
      "rag.figure",
      { docId: D3, n: "40" },
      dir,
    );
    expect(f).toMatchObject({ anchor: "fig:40", picture: true, exists: true });
    await expect(call("rag.passage", { ref: "GONE#§1" }, dir)).rejects.toMatchObject({ code: "doc-gone" });
  });

  it("rag.mentions and rag.related walk the index without a model", async () => {
    await call("rag.index", {}, dir);
    const m = await call<{ total: number; docs: { docId: string }[] }>("rag.mentions", { term: "sectionneur" }, dir);
    expect(m.total).toBeGreaterThan(0);
    expect(m.docs.map((d) => d.docId)).toContain(D3);
    const r = await call<{ neighbours: { ref: string; kind: string }[] }>("rag.related", { ref: `${D3}#§5.6.6` }, dir);
    expect(r.neighbours.some((n) => n.kind === "parent" && n.ref === `${D3}#§5.6`)).toBe(true);
  });

  it("rag.eval writes its report, rag.compare reads two of them", async () => {
    const a = await call<{ report: string }>("rag.eval", { mode: "bm25" }, dir);
    const b = await call<{ report: string }>("rag.eval", {}, dir);
    expect(existsSync(a.report)).toBe(true);
    const names = [a.report, b.report].map((f) => f.slice(join(dir, ".testimus", "eval").length + 1));
    const c = await call<{ baseline: string; rows: unknown[] }>("rag.compare", { reports: names, samples: 200 }, dir);
    expect(c.baseline).toBe(a.report);
    expect(c.rows).toHaveLength(1);
  });
});

describe("search commands through the registry", () => {
  it("search.all finds tests and passages, search.index embeds the tests", async () => {
    await call("rag.index", {}, dir);
    const idx = await call<{ embedded: number; total: number }>("search.index", {}, dir);
    expect(idx.total).toBeGreaterThan(0);
    expect(idx.embedded).toBe(idx.total);
    const r = await call<{ hits: { kind: string }[]; meaning: string }>("search.all", { query: "sectionneur" }, dir);
    expect(r.meaning).toBe("on");
    expect(r.hits.some((h) => h.kind === "passage")).toBe(true);
    const words = await call<{ meaning: string }>("search.all", { query: "sectionneur", meaning: false }, dir);
    expect(words.meaning).toBe("off");
  });
});
