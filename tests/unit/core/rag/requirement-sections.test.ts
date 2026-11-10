import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkDoc, parseSections } from "../../../../src/core/rag/chunk.ts";
import { type ChunkRow, getMeta, setMeta, withDb } from "../../../../src/core/rag/db.ts";
import { docEdges } from "../../../../src/core/rag/graph.ts";
import { related } from "../../../../src/core/rag/related.ts";
import { keep } from "../../../../src/core/rag/search/filter.ts";
import type { DocJson } from "../../../../src/core/types.ts";

const SPEC = [
  "# SPEC — Traction",
  "",
  "## 5 Objets <!-- § 5 -->",
  "",
  "Les objets de traction.",
  "",
  "### 5.6 Liste <!-- § 5.6 -->",
  "",
  "#### 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->",
  "",
  "##### EXI_A_1650 <!-- § exi-a-1650 -->",
  "",
  "Il existe trois types.",
  "",
  "![Figure 40 – Représentation](figures/fig-40.png) <!-- fig 40 -->",
  "",
  "##### EXI_A_1660 <!-- § exi-a-1660 -->",
  "",
  "Il est constitué d'un libellé statique.",
  "",
  "#### 5.6.7 DI <!-- § 5.6.7 -->",
  "",
  "##### EXI_A_1690 <!-- § exi-a-1690 -->",
  "",
  "Le DI est affiché.",
  "",
  "## Annexe <!-- § annexe -->",
  "",
  "Texte de l'annexe.",
].join("\n");

const doc = { id: "SPEC", code: "SPEC", title: "Traction" } as DocJson;
const of = (anchor: string) => {
  const s = parseSections(SPEC).find((x) => x.anchor === anchor);
  if (!s) throw new Error(`no section ${anchor}`);
  return s;
};

describe("a section without a number sits under the heading above it", () => {
  it("its path lists the sections that hold it; a numbered section's path is still its number's", () => {
    expect(of("§exi-a-1660").path).toBe("5 > 5.6 > 5.6.6 > exi-a-1660");
    expect(of("§exi-a-1660").parent).toBe("§5.6.6");
    expect(of("§exi-a-1690").path).toBe("5 > 5.6 > 5.6.7 > exi-a-1690");
    expect(of("§5.6.6").path).toBe("5 > 5.6 > 5.6.6");
    expect(of("§annexe")).toMatchObject({ path: "annexe", parent: "" });
  });

  it("its passage's header says where it is, so the heading's title is searched with it", () => {
    const chunks = chunkDoc(doc, SPEC, []);
    const header = (id: string) => chunks.find((c) => c.id === id)?.header;
    expect(header("SPEC#§exi-a-1660")).toBe("SPEC Traction — 5 > 5.6 > 5.6.6 Sectionneur (S) > EXI_A_1660");
    expect(header("SPEC#fig:40")).toBe("SPEC Traction — 5 > 5.6 > 5.6.6 Sectionneur (S) > EXI_A_1650");
    expect(header("SPEC#§5")).toBe("SPEC Traction — 5 Objets");
    expect(header("SPEC#§annexe")).toBe("SPEC Traction — Annexe");
    expect(chunks.find((c) => c.id === "SPEC#fig:40")?.path).toBe("5 > 5.6 > 5.6.6 > exi-a-1650");
  });

  it("the graph links it to that heading and to the other unnumbered sections of it", () => {
    const edges = docEdges(join(tmpdir(), "testimus-no-such-project"), doc, SPEC, []);
    const list = (kind: string) =>
      edges
        .filter((e) => e.kind === kind && /exi|annexe/.test(`${e.from} ${e.to}`))
        .map((e) => `${e.from} -> ${e.to}`)
        .sort();
    expect(list("parent")).toEqual([
      "SPEC#§exi-a-1650 -> SPEC#§5.6.6",
      "SPEC#§exi-a-1660 -> SPEC#§5.6.6",
      "SPEC#§exi-a-1690 -> SPEC#§5.6.7",
    ]);
    expect(list("sibling")).toEqual(["SPEC#§exi-a-1650 -> SPEC#§exi-a-1660", "SPEC#§exi-a-1660 -> SPEC#§exi-a-1650"]);
  });

  it("the section filter keeps the requirements of the section asked for, and only those", () => {
    const rows = chunkDoc(doc, SPEC, []).map((c) => ({ ...c, rowid: 0 }) as unknown as ChunkRow);
    const kept = (section: string) =>
      rows
        .filter((c) => keep(c, { section }))
        .map((c) => c.anchor)
        .sort();
    expect(kept("5.6.6")).toEqual(["fig:40", "§exi-a-1650", "§exi-a-1660"]);
    expect(kept("§5.6.7")).toEqual(["§exi-a-1690"]);
  });
});

describe("an index written before this rule", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-chunk-rules-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("forgets which documents it saw, once: each is chunked again and says it is not up to date", () => {
    const file = join(dir, "rag.db");
    const seen = (db: Parameters<typeof getMeta>[0]) => ({
      docs: (db.prepare("select count(*) n from docs").get() as { n: number }).n,
      state: JSON.parse(getMeta(db, "index_state") ?? "null") as { embedding: string; docs: Record<string, string> },
    });
    const write = (db: Parameters<typeof getMeta>[0]) => {
      db.prepare("insert into docs(doc_id, sha256, content) values ('SPEC', 'a', 'b')").run();
      setMeta(db, "index_state", JSON.stringify({ embedding: "m", docs: { SPEC: "b" } }));
    };
    withDb(file, (db) => {
      write(db);
      db.exec("delete from meta where key = 'chunk_rules'");
    });
    expect(withDb(file, seen)).toEqual({ docs: 0, state: { embedding: "m", docs: { SPEC: "" } } });
    withDb(file, write);
    expect(withDb(file, seen)).toEqual({ docs: 1, state: { embedding: "m", docs: { SPEC: "b" } } });
  });
});

describe("rag.related on a requirement", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-requirement-sections-"));
    writeFileSync(join(dir, "project.json"), "{}");
    const add = (id: string, md: string, json: Record<string, unknown>) => {
      mkdirSync(join(dir, "docs", id), { recursive: true });
      writeFileSync(join(dir, "docs", id, "doc.md"), md);
      writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify({ id, code: id, status: "validated", ...json }));
    };
    add("SPEC", SPEC, { title: "Traction" });
    add("AMD", "# AMD\n\n## 1 Remarque <!-- § 1 -->\n\nVoir SPEC §5.6.6 pour le sectionneur.\n", { amends: ["SPEC"] });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("gives its heading, its figure, the requirements beside it and what amends the section above", () => {
    const r = related(dir, { ref: "SPEC#§exi-a-1650" });
    const got = r.neighbours.map((n) => `${n.kind} ${n.ref}`);
    expect(got).toContain("parent SPEC#§5.6.6");
    expect(got).toContain("sibling SPEC#§exi-a-1660");
    expect(got).toContain("shows SPEC#fig:40");
    expect(got).toContain("amends AMD#§1");
    expect(got).not.toContain("sibling SPEC#§exi-a-1690");
    expect(r.neighbours.find((n) => n.ref === "SPEC#§5.6.6")).toMatchObject({ title: "Sectionneur (S)" });
  });
});
