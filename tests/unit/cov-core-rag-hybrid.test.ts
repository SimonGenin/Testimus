import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import { packRetrieval, retrievalSettings, search } from "../../src/core/rag/search/hybrid.ts";
import type { SearchHit } from "../../src/core/types.ts";

let dir = "";
const addDoc = (id: string, md: string) => {
  mkdirSync(join(dir, "docs", id), { recursive: true });
  writeFileSync(join(dir, "docs", id, "doc.md"), md);
  writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify({ id, code: id, title: id, status: "validated" }));
};
const refs = (hits: SearchHit[]) => hits.map((h) => `${h.docId}#${h.anchor}${h.via ? ` via ${h.via}` : ""}`);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-hybrid-"));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
  addDoc(
    "SPEC_X",
    [
      "# SPEC_X",
      "",
      "## 1 Règles <!-- § 1 -->",
      "",
      "<!-- req EXI_X_1 -->",
      "Le frein se serre à l'arrêt.",
      "",
      "## 2 Tableau <!-- § 2 -->",
      "",
      "| Code | Section | Objet |",
      "| --- | --- | --- |",
      "| EXI_X_2 | 1 | Le frein se desserre au départ |",
    ].join("\n"),
  );
  addDoc(
    "SPEC_Y",
    [
      "# SPEC_Y",
      "",
      "## 1 Pantographe <!-- § 1 -->",
      "",
      "Le pantographe applique SPEC_X §1 et SPEC_X §9 (voir le chapitre 3).",
      "",
      "<!-- fig 2 --> Figure 2 – Schéma du pantographe",
      "",
      "## 3 Annexe <!-- § 3 -->",
      "",
      "Rien de plus.",
    ].join("\n"),
  );
  await indexProject(dir, quietCtx(dir), { model: null });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("retrieval settings", () => {
  it("a folder without project.json gets the defaults; a pack failure is no pack", async () => {
    const bare = mkdtempSync(join(tmpdir(), "testimus-cov-hybrid-bare-"));
    try {
      expect(retrievalSettings(bare).candidates).toBe(retrievalSettings(dir).candidates);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t", rag: { reference: 42 } }));
    expect(await packRetrieval(dir)).toBeUndefined();
  });
});

describe("search", () => {
  it("refuses a project without index", async () => {
    rmSync(join(dir, "index"), { recursive: true, force: true });
    await expect(search(dir, "frein", { mode: "bm25" })).rejects.toThrow(/no index yet/);
  });

  it("graph expansion adds the sections a hit cross-references, in its own and other documents", async () => {
    const all = refs(await search(dir, "pantographe applique", { mode: "bm25", k: 1, expand: "graph" }));
    expect(all).toEqual(["SPEC_Y#§1", "SPEC_X#§1 via graph", "SPEC_Y#§3 via graph"]);
    expect(refs(await search(dir, "pantographe applique", { mode: "bm25", k: 1, expand: "section" }))).toEqual([
      "SPEC_Y#§1",
    ]);
    const only = refs(
      await search(dir, "pantographe applique", { mode: "bm25", k: 1, expand: "graph", docIds: ["SPEC_Y"] }),
    );
    expect(only).toEqual(["SPEC_Y#§1", "SPEC_Y#§3 via graph"]);
  });

  it("a figure hit without a picture file has no figure path, nor one whose doc.md is gone", async () => {
    const fig = (await search(dir, "Schéma du pantographe", { mode: "bm25", k: 5 })).find((h) => h.kind === "figure");
    expect(fig).toBeDefined();
    expect(fig?.figure).toBeUndefined();
    rmSync(join(dir, "docs", "SPEC_Y", "doc.md"));
    const again = (await search(dir, "Schéma du pantographe", { mode: "bm25", k: 5 })).find((h) => h.kind === "figure");
    expect(again?.figure).toBeUndefined();
  });
});
