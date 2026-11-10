import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { readJson, readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { chunkDoc, type DescribeChunks, parseSections } from "../../../../src/core/rag/chunk.ts";
import { runtimes } from "../../../../src/core/rag/embed.ts";
import { hitMatches, score } from "../../../../src/core/rag/eval-score.ts";
import { indexProject, readState } from "../../../../src/core/rag/indexer.ts";
import { mockRuntime } from "../../../../src/core/rag/runtimes/mock.ts";
import { rrf, search, searchChunks } from "../../../../src/core/rag/search/hybrid.ts";
import { figure, passage } from "../../../../src/core/rag/search/passage.ts";
import type { DocJson, FigureEntry } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";

let dir: string;
let calls: string[];

function docOf(id: string): { doc: DocJson; md: string; figures: FigureEntry[] } {
  const d = join(FIXTURE, "docs", id);
  return {
    doc: { ...readJson<DocJson>(join(d, "doc.json"), {} as DocJson), id },
    md: readFileSync(join(d, "doc.md"), "utf8"),
    figures: readJson<FigureEntry[]>(join(d, "figures.json"), []),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-rag-"));
  cpSync(FIXTURE, dir, { recursive: true });
  calls = [];
  env.mock = true;
  runtimes.mock = {
    ...mockRuntime,
    embed: async (m, texts, mode) => {
      calls.push(...texts.map((t) => `${mode}:${m.entry.id}:${t.slice(0, 30)}`));
      return mockRuntime.embed(m, texts, mode);
    },
  };
});

afterEach(() => {
  env.mock = false;
  runtimes.mock = mockRuntime;
  rmSync(dir, { recursive: true, force: true });
});

describe("chunking", () => {
  it("makes one chunk per section with anchors, paths and figures", () => {
    const { doc, md, figures } = docOf(D3);
    const chunks = chunkDoc(doc, md, figures);
    expect(chunks.map((c) => c.id)).toEqual([`${D3}#§5`, `${D3}#§5.6`, `${D3}#§5.6.6`, `${D3}#§5.6.7`, `${D3}#fig:40`]);
    const s = chunks[2];
    expect(s.path).toBe("5 > 5.6 > 5.6.6");
    expect(s.figureIds).toEqual(["40"]);
    expect(s.header).toBe(`${D3} Traction — 5 > 5.6 > 5.6.6 Sectionneur (S)`);
    expect(s.text).not.toContain("<!--");
    expect(s.text).toContain("Autoriser l'ouverture");
    expect(chunks[0].text).toContain("EXI_MOP_SPF_510_A_20 : Le TCO à deux rangs");
    expect(chunks[0].text).not.toContain("Objets de traction");
    const f = chunks[4];
    expect(f).toMatchObject({ kind: "figure", anchor: "fig:40", path: "5 > 5.6 > 5.6.6", figureIds: ["40"] });
    expect(f.text).toContain("Représentation graphique sectionneur");
    expect(f.text).toContain("carré blanc");
  });

  it("splits a long section on paragraphs, never across a heading", () => {
    const para = (i: number) => `Paragraphe ${i} ${"mot ".repeat(200)}`;
    const md = `## 1 Long <!-- § 1 -->\n\n${[1, 2, 3, 4, 5].map(para).join("\n\n")}\n\n## 2 Court <!-- § 2 -->\n\nFin.`;
    const doc = { id: "D", code: "D", title: "T" } as DocJson;
    const chunks = chunkDoc(doc, md, []);
    const long = chunks.filter((c) => c.anchor === "§1");
    expect(long.length).toBeGreaterThan(1);
    expect(long.map((c) => c.id)).toEqual(long.map((_, i) => `D#§1~${i + 1}`));
    expect(long.every((c) => !c.text.includes("Fin."))).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ id: "D#§2", text: "Fin." });
  });

  it("anchors unnumbered headings by their slug", () => {
    const s = parseSections("## Introduction <!-- § introduction -->\n\nTexte.");
    expect(s[0]).toMatchObject({ anchor: "§introduction", path: "introduction", title: "Introduction", number: "" });
  });
});

describe("search primitives", () => {
  it("fuses ranked lists by reciprocal rank (k = 60)", () => {
    const fused = rrf([
      [1, 2, 3],
      [3, 1],
    ]);
    expect(fused.map(([id]) => id)).toEqual([1, 3, 2]);
    expect(fused[0][1]).toBeCloseTo(1 / 61 + 1 / 62);
    expect(fused[2][1]).toBeCloseTo(1 / 62);
  });

  it("matches an expected anchor by section or figure", () => {
    const c = { docId: D3, anchor: "§5.6.6", figureIds: ["40"] };
    expect(hitMatches(c, `${D3}#§5.6.6`)).toBe(true);
    expect(hitMatches(c, `${D3}#req:EXI_MOP_SPF_511_A_1670`)).toBe(false);
    expect(hitMatches(c, `${D3}#fig:40`)).toBe(true);
    expect(hitMatches(c, `${D3}#§5.6.7`)).toBe(false);
    expect(hitMatches(c, `${D4}#§5.6.6`)).toBe(false);
  });

  it("scores recall@5, recall@10 and MRR", () => {
    expect(score([1, 2, 7, null], 10)).toEqual({ n: 4, recall5: 0.5, recall10: 0.75, mrr: (1 + 0.5 + 1 / 7) / 4 });
  });
});

describe("index", () => {
  it("indexes the fixture project and finds a code exactly with BM25", async () => {
    const r = await indexProject(dir, quietCtx(dir));
    expect(r).toMatchObject({ embedding: "bge-m3-q8", dims: 1024, vectorsRebuilt: true, chunks: 15, embedded: 15 });
    expect(calls.every((c) => c.startsWith("doc:bge-m3-q8:"))).toBe(true);
    const state = readState(dir);
    expect(state).toMatchObject({
      embedding: "bge-m3-q8",
      dims: 1024,
      space: r.space,
      docs: { [D3]: expect.stringMatching(/^[0-9a-f]{64}$/), [D4]: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    const hits = await searchChunks(dir, "EXI_MOP_SPF_511_A_1670", { mode: "bm25" });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.id).toBe(`${D3}#§5.6.6`);
    expect(hits[0].chunk.text).toContain("EXI_MOP_SPF_511_A_1670");
  });

  it("returns hybrid hits with figure files and a query-side embedding", async () => {
    await indexProject(dir, quietCtx(dir));
    calls = [];
    const q = "représentation graphique du sectionneur";
    const hits = await search(dir, q, { k: 5 });
    expect(calls).toEqual([`query:bge-m3-q8:${q.slice(0, 30)}`]);
    const fig = hits.find((h) => h.kind === "figure");
    expect(fig).toMatchObject({ anchor: "fig:40", figure: `docs/${D3}/figures/fig-40.png` });
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("is incremental, and embeds a new space when the model changes", async () => {
    await indexProject(dir, quietCtx(dir));
    calls = [];
    const again = await indexProject(dir, quietCtx(dir));
    expect(again.docs.every((d) => d.status === "unchanged")).toBe(true);
    expect(again.embedded).toBe(0);

    const md4 = join(dir, "docs", D4, "doc.md");
    writeFileSync(
      md4,
      `${readFileSync(md4, "utf8")}\n\n## 4.3 Signal de manœuvre <!-- § 4.3 -->\n\nAutorise la manœuvre.\n`,
    );
    const changed = await indexProject(dir, quietCtx(dir));
    expect(changed.docs.find((d) => d.docId === D4)?.status).toBe("indexed");
    expect(changed.docs.find((d) => d.docId === D3)?.status).toBe("unchanged");
    expect(changed.embedded).toBe(1);

    const p = readProject(dir);
    writeProject(dir, {
      ...p,
      rag: { ...p.rag, reference: { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null } },
    });
    calls = [];
    const rebuilt = await indexProject(dir, quietCtx(dir));
    expect(rebuilt.vectorsRebuilt).toBe(true);
    expect(rebuilt.embedded).toBe(rebuilt.chunks);
    expect(rebuilt.docs.every((d) => d.status === "unchanged")).toBe(true);
    expect(calls.every((c) => c.startsWith("doc:qwen3-embedding-0.6b-onnx-q8:"))).toBe(true);
    expect(readState(dir)?.embedding).toBe("qwen3-embedding-0.6b-onnx-q8");

    rmSync(join(dir, "docs", D4), { recursive: true });
    const removed = await indexProject(dir, quietCtx(dir));
    expect(removed.docs.find((d) => d.docId === D4)?.status).toBe("removed");
    expect(removed.chunks).toBe(13);
  });

  it("falls back to BM25 when the active model has no vectors yet, instead of refusing", async () => {
    await indexProject(dir, quietCtx(dir));
    const p = readProject(dir);
    writeProject(dir, {
      ...p,
      rag: { ...p.rag, reference: { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null } },
    });
    calls = [];
    const hits = await search(dir, "EXI_MOP_SPF_511_A_1670");
    expect(hits[0].anchor).toBe("§5.6.6");
    expect(calls).toEqual([]);
  });

  it("an old superseded mark no longer hides a document; docIds narrows the search", async () => {
    const f = join(dir, "docs", D4, "doc.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), status: "superseded" }));
    await indexProject(dir, quietCtx(dir));
    const out = await search(dir, "signal d'arrêt fermé", { mode: "bm25" });
    expect(out[0].docId).toBe(D4);
    const only = await search(dir, "menu", { mode: "bm25", docIds: [D3] });
    expect(only.every((h) => h.docId === D3)).toBe(true);
  });

  it("uses the describe option for new chunks and falls back to the default header", async () => {
    const describe: DescribeChunks = async (doc, chunks) =>
      chunks.map((c) => `Cette section de ${doc.code} décrit ${c.anchor}.`);
    await indexProject(dir, quietCtx(dir), { describe });
    const [hit] = await searchChunks(dir, "EXI_MOP_SPF_511_A_1670", { mode: "bm25" });
    expect(hit.chunk.header).toBe(`Cette section de ${D3} décrit §5.6.6.`);

    const failing: DescribeChunks = async () => {
      throw new Error("claude unavailable");
    };
    const warns: string[] = [];
    await indexProject(dir, { ...quietCtx(dir), log: (_l, m) => warns.push(m) }, { force: true, describe: failing });
    const [again] = await searchChunks(dir, "EXI_MOP_SPF_511_A_1670", { mode: "bm25" });
    expect(again.chunk.header).toBe(`${D3} Traction — 5 > 5.6 > 5.6.6 Sectionneur (S)`);
    expect(warns.join()).toMatch(/default used/);
  });
});

describe("passages", () => {
  it("reads a section by § and a figure by fig:", () => {
    const s = passage(dir, `${D3}#§5.6.6`);
    expect(s).toMatchObject({ anchor: "§5.6.6", path: "5 > 5.6 > 5.6.6", title: "Sectionneur (S)" });
    expect(s.text).toContain("Confirmer la fermeture");
    expect(s.text).not.toContain("<!--");
    expect(s.figures.map((f) => f.anchor)).toEqual(["fig:40"]);
    expect(s.doc).toMatchObject({ code: D3, status: "validated" });

    expect(() => passage(dir, `${D3}#req:EXI_MOP_SPF_511_A_1680`)).toThrow(/no anchor/);

    const f = passage(dir, `${D3}#fig:40`);
    expect(f).toMatchObject({
      anchor: "fig:40",
      path: "5 > 5.6 > 5.6.6",
      title: "Figure 40 – Représentation graphique sectionneur",
    });
    expect(f.figures[0].description).toContain("carré blanc");

    expect(passage(dir, `${D3}#5.6.7`).title).toBe("Disjoncteur (D)");
    expect(() => passage(dir, `${D3}#§9.9`)).toThrow(/no anchor §9.9/);
    expect(() => passage(dir, "nope")).toThrow(/not a source reference/);
  });

  it("returns a figure entry with its file", () => {
    const f = figure(dir, D3, "40");
    expect(f).toMatchObject({ n: "40", file: `docs/${D3}/figures/fig-40.png`, exists: true, path: "5 > 5.6 > 5.6.6" });
    expect(figure(dir, D3, "fig:40").n).toBe("40");
  });
});

describe("rag commands", () => {
  it("index, status, search and passage through the registry", async () => {
    const before = (await invoke("rag.status", {}, { project: dir })) as {
      exists: boolean;
      docs: { indexed: string }[];
    };
    expect(before.exists).toBe(false);
    expect(before.docs.map((d) => d.indexed)).toEqual(["missing", "missing", "missing", "missing", "missing"]);
    await invoke("rag.index", {}, { project: dir });
    const after = (await invoke("rag.status", {}, { project: dir })) as {
      chunks: number;
      profileMatches: boolean;
      docs: { indexed: string }[];
    };
    expect(after).toMatchObject({ chunks: 15, profileMatches: true });
    expect(after.docs.map((d) => d.indexed)).toEqual(["fresh", "fresh", "fresh", "fresh", "fresh"]);
    const hits = (await invoke("rag.search", { query: "EXI_MOP_SPF_511_A_1670" }, { project: dir })) as {
      anchor: string;
    }[];
    expect(hits[0].anchor).toBe("§5.6.6");
    const p = (await invoke("rag.passage", { ref: `${D3}#§5.6.6` }, { project: dir })) as { text: string };
    expect(p.text).toContain("Annuler l'autorisation d'ouverture");
  });
});
