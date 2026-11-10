import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leftOutDocs, refuseLeftOut, WITHOUT_DOCS } from "../../../../src/core/claude/access.ts";
import { UserError } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { docIds } from "../../../../src/core/lib/docs.ts";
import { call, fixtureCopy } from "../registry.ts";

// ponytail: the user took a document out of a run — the run's own MCP server is started with its id in the
// environment (claude/run.ts), and what Claude calls through it neither finds nor reads the document; the same
// commands called by a person (the page, the CLI) are not held to it

const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";
const EVIDENCE = join(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project");
const LLM = { llm: true };
const realMock = env.mock;
let dir: string;

type Hit = { docId: string; anchor: string };
type Mentions = { total: number; pages: number; docs: { docId: string; count: number }[] };
type Related = { neighbours: { ref: string }[] };

const leaveOut = (...ids: string[]) => {
  process.env[WITHOUT_DOCS] = ids.join(",");
};

beforeEach(async () => {
  dir = fixtureCopy("rag-left-out");
  env.mock = true;
  await call("rag.index", {}, dir);
});

afterEach(() => {
  env.mock = realMock;
  delete process.env[WITHOUT_DOCS];
  rmSync(dir, { recursive: true, force: true });
});

describe("a document left out of a run", () => {
  it("is named to the run's MCP server; only a call by an LLM is held to it", () => {
    expect(WITHOUT_DOCS).toBe("TESTIMUS_WITHOUT_DOCS");
    expect(leftOutDocs(true, dir)).toEqual([]);
    leaveOut(D3, D4);
    expect(leftOutDocs(true, dir)).toEqual([D3, D4]);
    expect(leftOutDocs(false, dir)).toEqual([]);
    expect(leftOutDocs(undefined, dir)).toEqual([]);
    expect(() => refuseLeftOut(true, "RECETTE_TCO_12-10", dir)).not.toThrow();
    expect(() => refuseLeftOut(false, D3, dir)).not.toThrow();
    expect(() => refuseLeftOut(undefined, D3, dir)).not.toThrow();
    let refused: unknown;
    try {
      refuseLeftOut(true, D3, dir);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(UserError);
    expect(refused).toMatchObject({
      message: `${D3} is left out of this run.`,
      fix: "The user took this document out of the run: do not search, read or cite it.",
      code: "doc-left-out",
    });
  });

  it("rag.search does not find it for Claude, and still does for a person", async () => {
    const all = await call<Hit[]>("rag.search", { query: "sectionneur menu contextuel" }, dir, LLM);
    expect(all.some((h) => h.docId === D3)).toBe(true);
    leaveOut(D3);
    const without = await call<Hit[]>("rag.search", { query: "sectionneur menu contextuel" }, dir, LLM);
    expect(without.some((h) => h.docId === D3)).toBe(false);
    const person = await call<Hit[]>("rag.search", { query: "sectionneur menu contextuel" }, dir);
    expect(person.some((h) => h.docId === D3)).toBe(true);
  });

  it("rag.search with no document left to search answers nothing — never « all the documents »", async () => {
    leaveOut(D3);
    expect(await call<Hit[]>("rag.search", { query: "sectionneur", docIds: [D3] }, dir, LLM)).toEqual([]);
    const narrowed = await call<Hit[]>("rag.search", { query: "signal", docIds: [D3, D4] }, dir, LLM);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.every((h) => h.docId === D4)).toBe(true);
    leaveOut(...docIds(dir));
    expect(await call<Hit[]>("rag.search", { query: "sectionneur" }, dir, LLM)).toEqual([]);
  });

  it("rag.mentions counts no hit in it; with no document left the answer is empty", async () => {
    const all = await call<Mentions>("rag.mentions", { term: "sectionneur" }, dir, LLM);
    expect(all.docs.map((d) => d.docId)).toContain(D3);
    leaveOut(D3);
    const without = await call<Mentions>("rag.mentions", { term: "sectionneur" }, dir, LLM);
    expect(without.docs.map((d) => d.docId)).not.toContain(D3);
    expect(without.total).toBeLessThan(all.total);
    expect(await call<Mentions>("rag.mentions", { term: "sectionneur", docIds: [D3] }, dir, LLM)).toEqual({
      term: "sectionneur",
      forms: [],
      total: 0,
      sections: 0,
      page: 1,
      pages: 0,
      docs: [],
    });
    expect((await call<Mentions>("rag.mentions", { term: "sectionneur" }, dir)).total).toBe(all.total);
  });

  it("rag.passage, rag.figure, rag.related and docs.show refuse it by name for Claude, not for a person", async () => {
    leaveOut(D3);
    const refused = { code: "doc-left-out", message: `${D3} is left out of this run.` };
    await expect(call("rag.passage", { ref: `${D3}#§5.6.6` }, dir, LLM)).rejects.toMatchObject(refused);
    await expect(call("rag.figure", { docId: D3, n: "40" }, dir, LLM)).rejects.toMatchObject(refused);
    await expect(call("rag.related", { ref: `${D3}#§5.6.6` }, dir, LLM)).rejects.toMatchObject(refused);
    await expect(call("docs.show", { id: D3 }, dir, LLM)).rejects.toMatchObject(refused);
    await expect(call("rag.passage", { ref: `${D3}#§5.6.6` }, dir)).resolves.toBeTruthy();
    await expect(call("docs.show", { id: D3 }, dir)).resolves.toMatchObject({ doc: { id: D3 } });
    await expect(call("docs.show", { id: D4 }, dir, LLM)).resolves.toMatchObject({ doc: { id: D4 } });
  });

  it("rag.related leaves out the neighbours that sit in it: the document that amends the section too", async () => {
    const linked = mkdtempSync(join(tmpdir(), "testimus-rag-left-out-links-"));
    cpSync(EVIDENCE, linked, { recursive: true });
    const ref = "SPEC_A#§2.1";
    const docOf = (n: { ref: string }) => n.ref.split("#")[0];
    const all = await call<Related>("rag.related", { ref }, linked, LLM);
    expect(all.neighbours.map(docOf)).toContain("PA1_SPEC_A");
    leaveOut("PA1_SPEC_A");
    const without = await call<Related>("rag.related", { ref }, linked, LLM);
    expect(without.neighbours.map((n) => n.ref)).toEqual(
      all.neighbours.filter((n) => docOf(n) !== "PA1_SPEC_A").map((n) => n.ref),
    );
    expect(without.neighbours.length).toBeGreaterThan(0);
    expect((await call<Related>("rag.related", { ref }, linked)).neighbours).toHaveLength(all.neighbours.length);
  });
});
