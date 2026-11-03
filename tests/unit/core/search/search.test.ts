import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { find } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { foldKeep } from "../../../../src/core/rag/stem-fr.ts";
import { marksIn, searchAll } from "../../../../src/core/search/all.ts";
import { compile, corpus, distance, field, search, snippet } from "../../../../src/core/search/match.ts";
import { parseQuery } from "../../../../src/core/search/query.ts";
import { embedTests, embedText, vectorsFile } from "../../../../src/core/search/vectors.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const real = env.mock;
let dir = "";

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-search-")), "P");
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
});

afterEach(() => {
  env.mock = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const docs = (...texts: string[]) => texts.map((t, i) => ({ id: i, fields: [field("text", t, 1)] }));
const ids = (q: string, ...texts: string[]) => {
  const c = corpus(docs(...texts));
  return search(compile(parseQuery(q), c.vocab), c.docs).map((s) => s.doc.id);
};

describe("parseQuery", () => {
  it("splits words, phrases, exclusions and filters; an unknown key stays text", () => {
    const q = parseQuery(
      'menu "fenêtre Propriétés" -ouverture in:tests review:fix label:"Sprint 3" ref:ABC_1 has:findings',
    );
    expect(q.terms).toEqual(["menu", "ref:ABC_1"]);
    expect(q.phrases).toEqual(["fenêtre Propriétés"]);
    expect(q.exclude).toEqual(["ouverture"]);
    expect(q.filters).toEqual({ in: ["test"], review: ["to-fix"], label: ["sprint 3"], has: ["findings"] });
    expect(q.text).toBe("menu fenêtre Propriétés ref:ABC_1");
  });

  it("reads the other filters and their aliases, and keeps a filter with a bad value as text", () => {
    const q = parseQuery("in:passages in:docs sync:mod folder:Traction doc:sosie is:awaiting review:nope");
    expect(q.filters).toEqual({
      in: ["passage", "document"],
      sync: ["modified"],
      folder: ["/traction"],
      doc: ["sosie"],
      is: ["awaiting"],
    });
    expect(q.terms).toEqual(["review:nope"]);
  });
});

describe("matching", () => {
  it("folds accents without moving offsets", () => {
    expect(foldKeep("Fenêtre Œuvre")).toBe("fenetre œuvre");
    expect(foldKeep("Ça")).toHaveLength(2);
  });

  it("counts typos with transpositions and stops past the limit", () => {
    expect(distance("sectionneur", "sectioneur", 2)).toBe(1);
    expect(distance("ferme", "freme", 1)).toBe(1);
    expect(distance("abc", "xyzuvw", 1)).toBe(2);
  });

  it("finds a word by its accents, its French form, its prefix and a typo", () => {
    const texts = ["Le sectionneur est ouvert", "Les propriétés du disjoncteur", "Fermer la fenêtre"];
    expect(ids("SECTIONNEUR", ...texts)).toEqual([0]);
    expect(ids("propriete", ...texts)).toEqual([1]);
    expect(ids("fermé", ...texts)).toEqual([2]);
    expect(ids("disj", ...texts)).toEqual([1]);
    expect(ids("sectioneur", ...texts)).toEqual([0]);
  });

  it("needs every word, ranks a doc where they meet first, and falls back to most words", () => {
    expect(ids("menu sectionneur", "menu du sectionneur", "menu seul", "sectionneur seul")).toEqual([0]);
    expect(ids("menu sectionneur zzzz", "menu", "menu du sectionneur")).toEqual([1]);
  });

  it("matches codes and phrases as written, and drops excluded words", () => {
    const texts = [
      "EXI_MOP_SPF_511_A_1650 le symbole",
      "LFRPS12-1420 menu contextuel",
      "menu du sectionneur contextuel",
    ];
    expect(ids("EXI_MOP_SPF_511", ...texts)).toEqual([0]);
    expect(ids("lfrps12-1420", ...texts)).toEqual([1]);
    expect(ids('"menu contextuel"', ...texts)).toEqual([1]);
    expect(ids("menu -sectionneur", ...texts)).toEqual([1]);
    expect(ids('menu -"du sectionneur"', ...texts)).toEqual([1]);
  });

  it("cuts a snippet around the first mark and moves the marks into it", () => {
    const text = `${"a ".repeat(100)}cible${" b".repeat(100)}`;
    const s = snippet(text, [[200, 205]], 60);
    expect(s.text.startsWith("…")).toBe(true);
    expect(s.text.endsWith("…")).toBe(true);
    const [[a, b]] = s.marks;
    expect(s.text.slice(a, b)).toBe("cible");
    expect(snippet("court", [[0, 5]])).toEqual({ text: "court", marks: [[0, 5]] });
  });

  it("marks a query inside any text", () => {
    const text = "Le menu contextuel du sectionneur";
    expect(marksIn(text, parseQuery("sectionneurs menu")).map(([a, b]) => text.slice(a, b))).toEqual([
      "menu",
      "sectionneur",
    ]);
  });
});

describe("searchAll", () => {
  it("finds a test by a step and says where", async () => {
    const r = await searchAll(dir, { query: "fenetre proprietes", meaning: false });
    const test = r.hits.find((h) => h.kind === "test");
    expect(test).toMatchObject({ id: "LFRPS12-1420", review: "checked", why: "words" });
    expect(r.meaning).toBe("off");
  });

  it("puts the kind of an exact key first, and never asks the meaning of a code", async () => {
    const r = await searchAll(dir, { query: "EXI_MOP_SPF_511_A_1670" });
    expect(r.meaning).toBe("off");
    const t = await searchAll(dir, { query: "LFRPS12-1398" });
    expect(t.order[0]).toBe("test");
    expect(t.hits[0]).toMatchObject({ kind: "test", id: "LFRPS12-1398", titleMarks: [] });
  });

  it("lists the tests a filter keeps when there is no text, newest first", async () => {
    const r = await searchAll(dir, { query: "review:to-fix" });
    expect(r.hits.map((h) => [h.id, h.why])).toEqual([["local-3f9a12c0", "filter"]]);
    expect(r.order[0]).toBe("test");
    const none = await searchAll(dir, { query: "folder:/Signalisation has:key" });
    expect(none.hits).toEqual([]);
  });

  it("finds documents by code and passages by words once the index exists", async () => {
    const before = await searchAll(dir, { query: "schématique", in: ["passage"] });
    expect(before.hits).toEqual([]);
    await indexProject(dir, quietCtx(dir), {});
    const r = await searchAll(dir, { query: "schématique traction -signaux", meaning: false });
    const passages = r.hits.filter((h) => h.kind === "passage");
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((p) => !/signaux/i.test(p.snippet ?? ""))).toBe(true);
    const d = await searchAll(dir, { query: "in:docs signalisation" });
    expect(d.hits.map((h) => h.id)).toEqual(["SOSIE_211_D401-1_4"]);
  }, 30000);

  it("adds tests found by their meaning once they are embedded, and keeps the exclusions", async () => {
    const r = await searchAll(dir, { query: "disjoncteur", in: ["test"] });
    expect(r.meaning).toBe("on");
    expect(r.unembedded).toBe(0);
    expect(existsSync(vectorsFile(dir))).toBe(true);
    expect(r.hits[0]).toMatchObject({ id: "LFRPS12-1398", why: "both" });
    const ex = await searchAll(dir, { query: "menu -disjoncteur", in: ["test"] });
    expect(ex.hits.map((h) => h.id)).not.toContain("LFRPS12-1398");
  });
});

describe("embedTests", () => {
  it("embeds only new or changed tests and forgets removed ones", async () => {
    const first = await embedTests(dir);
    expect(first).toMatchObject({ embedded: 3, total: 3 });
    expect((await embedTests(dir)).embedded).toBe(0);
    const md = join(dir, "tests", "LFRPS12-1398", "test.md");
    writeFileSync(md, readFileSync(md, "utf8").replace("Disjoncteur — ouverture", "Disjoncteur — fermeture"));
    expect((await embedTests(dir)).embedded).toBe(1);
    rmSync(join(dir, "tests", "local-3f9a12c0"), { recursive: true });
    await embedTests(dir);
    const store = JSON.parse(readFileSync(vectorsFile(dir), "utf8"));
    expect(Object.keys(store.tests).sort()).toEqual(["LFRPS12-1398", "LFRPS12-1420"]);
  });

  it("writes summary, description and the steps' action and result", () => {
    const text = embedText({
      project: "P",
      summary: "S",
      folder: "/",
      labels: [],
      description: "D",
      covers: [],
      preconditions: [],
      review: "draft",
      extra: {},
      steps: [{ fields: { Action: "A", "Expected Result": "R", Data: "x" }, sources: [], images: [] }],
    });
    expect(text).toBe("S\nD\n1. A R");
  });
});

describe("search commands", () => {
  it("are in the registry, search.index as a job", () => {
    expect(find("search.all").positional).toEqual(["query"]);
    expect(find("search.index").job).toBe("search-index");
  });
});
