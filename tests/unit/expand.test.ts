import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { journalFile, readPerf } from "../../src/core/lib/models-perf.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import { search } from "../../src/core/rag/search/hybrid.ts";
import type { SearchHit } from "../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "evidence", "project");
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "testimus-expand-"));
  cpSync(FIXTURE, dir, { recursive: true });
  await indexProject(dir, quietCtx(dir), { model: null });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const refs = (hits: SearchHit[]) => hits.map((h) => `${h.docId}#${h.anchor}${h.via ? ` via ${h.via}` : ""}`);

describe("rag.search expand (SPEC-RAG §4.1)", () => {
  it("none adds nothing", async () => {
    const hits = await search(dir, "double clic", { mode: "bm25", k: 2 });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => !h.via)).toBe(true);
  });

  it("section adds the parent section that has text of its own after the k hits, flagged via", async () => {
    const top = await search(dir, "double clic", { mode: "bm25", k: 2 });
    const hits = await search(dir, "double clic", { mode: "bm25", k: 2, expand: "section" });
    expect(hits).toEqual(top);
    const parent = await search(dir, "reproduit le poste de commande centralisé", {
      mode: "bm25",
      k: 1,
      expand: "section",
    });
    expect(refs(parent)).toEqual(["SPEC_A#§1.1", "SPEC_A#§1 via section"]);
  });

  it("graph adds the sections a hit cross-references, in its document and others", async () => {
    const hits = await search(dir, "double clic", { mode: "bm25", k: 2, expand: "graph" });
    expect(refs(hits)).toEqual(["SPEC_A#§2.2", "SPEC_A#§6.1", "SPEC_B#§4.1 via graph", "SPEC_A#§2.1 via graph"]);
    expect(hits.find((h) => h.anchor === "§4.1")).toMatchObject({ docId: "SPEC_B", kind: "section", via: "graph" });
  });

  it("defaults to project.json rag.retrieval.expand, through the rag.search command", async () => {
    const file = join(dir, "project.json");
    const pj = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...pj, rag: { ...pj.rag, retrieval: { expand: "section" } } }));
    try {
      const hits = (await invoke(
        "rag.search",
        { query: "reproduit le poste de commande centralisé", mode: "bm25", k: 1 },
        { project: dir },
      )) as SearchHit[];
      expect(hits.some((h) => h.via === "section")).toBe(true);
      const none = (await invoke(
        "rag.search",
        { query: "double clic", mode: "bm25", k: 2, expand: "none" },
        { project: dir },
      )) as SearchHit[];
      expect(none).toHaveLength(2);
    } finally {
      writeFileSync(file, JSON.stringify(pj));
    }
  });

  it("logs search.bm25 and search.total with ids, counts and times only — never the query", async () => {
    await search(dir, "requête secrète sectionneur", { mode: "bm25", k: 3 });
    const ops = readPerf().map((l) => l.op);
    expect(ops).toContain("search.bm25");
    expect(ops).toContain("search.total");
    const raw = readFileSync(journalFile(), "utf8");
    expect(raw).not.toMatch(/secrète|sectionneur/);
    const total = readPerf()
      .filter((l) => l.op === "search.total")
      .pop();
    expect(total).toMatchObject({ op: "search.total" });
    expect(total?.ms).toBeGreaterThanOrEqual(0);
  });
});
