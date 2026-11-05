import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { RELATED_MAX, type Related, refInfo, related } from "../../../../src/core/rag/related.ts";

describe("rag.related", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project");
  let dir: string;

  function addDoc(id: string, md: string, extra: Record<string, unknown> = {}) {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    writeFileSync(
      join(dir, "docs", id, "doc.json"),
      JSON.stringify({ id, code: id, title: `Doc ${id}`, status: "validated", ...extra }),
    );
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-related-"));
    cpSync(FIXTURE, dir, { recursive: true });
    addDoc(
      "SPEC_C",
      [
        "# SPEC_C — C",
        "",
        "## 7 Rafraîchissement <!-- § 7 -->",
        "",
        "<!-- req EXI_MOP_SPF_100_A_20 -->",
        "Comme le demande EXI_MOP_SPF_100_A_20, la vue se rafraîchit (voir SPEC_B §4.1).",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const of = (r: Related, kind: string, direction?: "in" | "out", depth = 1) =>
    r.neighbours
      .filter((n) => n.kind === kind && (!direction || n.direction === direction) && n.depth === depth)
      .map((n) => n.ref);

  describe("rag.related (SPEC-RAG §3.3, §4.1)", () => {
    it("a section: parent, children, siblings, cross-references both ways, figures, amendments", () => {
      const r = related(dir, { ref: "SPEC_A#§2.1" });
      expect(r.ref).toBe("SPEC_A#§2.1");
      expect(of(r, "parent", "out")).toEqual(["SPEC_A#§2"]);
      expect(r.neighbours.filter((n) => n.kind === "sibling")).toMatchObject([
        { ref: "SPEC_A#§2.2", direction: "out" },
      ]);
      expect(of(r, "refers", "in")).toEqual(["SPEC_A#§1", "SPEC_A#§2.2"]);
      expect(of(r, "shows", "out")).toEqual(["SPEC_A#fig:1"]);
      expect(of(r, "amends", "in")).toEqual(["PA1_SPEC_A", "PA1_SPEC_A#§commentaires-majeurs"]);
      expect(r.neighbours.map((n) => n.kind)).toEqual([
        "amends",
        "amends",
        "parent",
        "refers",
        "refers",
        "shows",
        "sibling",
      ]);
      expect(r.neighbours.find((n) => n.ref === "SPEC_A#fig:1")?.title).toBe("Figure 1 – Vue ligne complète");
      expect(r.neighbours.find((n) => n.ref === "SPEC_A#§1")).toMatchObject({ title: "Généralités", path: "1" });
      expect(of(related(dir, { ref: "SPEC_A#§2" }), "parent", "in")).toEqual(["SPEC_A#§2.1", "SPEC_A#§2.2"]);
      expect(of(related(dir, { ref: "SPEC_B#§4.1" }), "refers", "in")).toEqual(["SPEC_A#§2.2", "SPEC_C#§7"]);
    });

    it("an old requirement marker is an ordinary comment: no edge, no anchor", () => {
      const r = related(dir, { ref: "SPEC_C#§7" });
      expect(r.neighbours.map((n) => `${n.kind} ${n.ref}`)).toEqual(["refers SPEC_B#§4.1"]);
      expect(() => related(dir, { ref: "SPEC_C#req:EXI_MOP_SPF_100_A_20" })).toThrow(/No anchor/);
      expect(() => related(dir, { ref: "EXI_MOP_SPF_100_A_20" })).toThrow(/No document EXI_MOP_SPF_100_A_20/);
    });

    it("an amendment reaches the sub-sections of the section it amends", () => {
      addDoc("PA2", "# PA2 — P\n\n## Remarques <!-- § remarques -->\n\nP3 § 2 : revoir l'affichage.\n", {
        amends: ["SPEC_A"],
      });
      expect(of(related(dir, { ref: "SPEC_A#§2.2" }), "amends", "in")).toContain("PA2#§remarques");
    });

    it("a figure and a whole document", () => {
      expect(of(related(dir, { ref: "SPEC_A#fig:1" }), "shows", "in")).toEqual(["SPEC_A#§2.1"]);
      const doc = related(dir, { ref: "SPEC_A" });
      expect(doc.ref).toBe("SPEC_A");
      expect(doc.neighbours).toMatchObject([{ ref: "PA1_SPEC_A", kind: "amends", direction: "in" }]);
    });

    it("depth 2 adds the neighbours of the neighbours, once, after depth 1", () => {
      const one = related(dir, { ref: "SPEC_A#§1" });
      const two = related(dir, { ref: "SPEC_A#§1", depth: 2 });
      expect(two.neighbours.slice(0, one.neighbours.length)).toEqual(one.neighbours);
      expect(of(two, "shows", "out", 2)).toEqual(["SPEC_A#fig:1"]);
      expect(of(two, "amends", "in", 2)).toEqual(["PA1_SPEC_A#§commentaires-majeurs"]);
      const depth1 = new Set(one.neighbours.map((n) => n.ref));
      for (const n of two.neighbours.filter((x) => x.depth === 2)) expect(depth1.has(n.ref)).toBe(false);
    });

    it("refuses what does not exist", () => {
      expect(() => related(dir, { ref: "NOPE#§1" })).toThrow(/No document NOPE/);
      expect(() => related(dir, { ref: "SPEC_A#§9.9" })).toThrow(/No anchor §9\.9/);
      expect(() => related(dir, { ref: "SPEC_A#fig:9" })).toThrow(/No anchor fig:9/);
    });

    it("gives the same neighbours with and without the index", async () => {
      const cases = ["SPEC_A#§2.1", "SPEC_A#fig:1", "PA1_SPEC_A#§commentaires-majeurs"];
      const before = cases.map((ref) => related(dir, { ref, depth: 2 }));
      await indexProject(dir, quietCtx(dir), { model: null });
      expect(cases.map((ref) => related(dir, { ref, depth: 2 }))).toEqual(before);
    });

    it("is the rag.related command", async () => {
      const r = (await invoke("rag.related", { ref: "SPEC_B#§4.1" }, { project: dir })) as Related;
      expect(r.ref).toBe("SPEC_B#§4.1");
      expect(r.neighbours.length).toBeGreaterThan(0);
    });
  });

  describe("recall tools reach Claude (SPEC-RAG §4.6, SPEC §11)", () => {
    it("rag_mentions, rag_related and review_evidence are read-only tools of every run kind", async () => {
      const { mcpAccess } = await import("../../../../src/core/claude/access.ts");
      for (const kind of ["chat", "check", "generate", "fix"] as const) {
        const { allow, deny } = await mcpAccess(kind);
        for (const t of ["rag_mentions", "rag_related", "review_evidence"]) {
          expect(allow, `${kind} ${t}`).toContain(`mcp__testimus__${t}`);
          expect(deny).not.toContain(`mcp__testimus__${t}`);
        }
      }
    });

    it("the product skills name them", async () => {
      const { readFileSync } = await import("node:fs");
      const skill = (n: string) =>
        readFileSync(
          join(import.meta.dirname, "..", "..", "..", "..", "templates", "project", ".claude", "skills", n, "SKILL.md"),
          "utf8",
        );
      for (const n of ["generate-tests", "check-test", "ask-docs", "fix-test"]) {
        expect(skill(n), n).toMatch(/rag_mentions/);
        expect(skill(n), n).toMatch(/rag_related/);
        expect(skill(n), n).toMatch(/^---\nname: /);
      }
      expect(skill("generate-tests")).toMatch(/"consulted": \[/);
      expect(skill("check-test")).toMatch(/`Read` the image/);
      expect(skill("check-test")).toMatch(/A test with no finding is a normal result/);
      expect(skill("check-test")).toMatch(/## The bar/);
      expect(skill("ask-docs")).toMatch(/only after `rag_mentions` and `rag_related` found nothing/);
    });
  });

  describe("depth 2 is bounded (review #17)", () => {
    it("stops at RELATED_MAX neighbours, keeps every depth-1 one, says truncated and the total; a sibling once", () => {
      const n = 260;
      addDoc(
        "BIG",
        [
          "# BIG — Règles",
          "",
          "## 1 Index <!-- § 1 -->",
          "",
          "La première règle est au § 2.1.",
          "",
          "## 2 Règles <!-- § 2 -->",
          "",
          ...Array.from({ length: n }, (_, i) => [
            `### 2.${i + 1} Règle ${i + 1} <!-- § 2.${i + 1} -->`,
            "",
            `La règle numéro ${i + 1} s'applique.`,
            "",
          ]).flat(),
        ].join("\n"),
      );
      const one = related(dir, { ref: "BIG#§1" });
      expect(one.truncated).toBeUndefined();
      const two = related(dir, { ref: "BIG#§1", depth: 2 });
      expect(two.neighbours).toHaveLength(RELATED_MAX);
      expect(two.truncated).toBe(true);
      expect(two.total).toBeGreaterThan(n);
      for (const x of one.neighbours)
        expect(two.neighbours.some((y) => y.ref === x.ref && y.kind === x.kind)).toBe(true);
      const sec = related(dir, { ref: "BIG#§2.1" });
      const siblings = sec.neighbours.filter((x) => x.kind === "sibling");
      expect(siblings).toHaveLength(n - 1);
      expect(new Set(siblings.map((x) => x.ref)).size).toBe(n - 1);
      expect(sec.truncated).toBeUndefined();
    });
  });
});

describe("rag.related — less common inputs", () => {
  let dir = "";
  const SPEC = [
    "# SPEC — Spécification",
    "",
    "<!-- fig 1 --> Figure 1 – Vue avant toute section",
    "",
    "## 1 Général <!-- § 1 -->",
    "",
    "La règle générale s'applique partout.",
    "",
    "### 1.1 Détail <!-- § 1.1 -->",
    "",
    "Le détail de la règle.",
  ].join("\n");

  const addDoc = (id: string, md: string, json: Record<string, unknown>) => {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify({ id, code: id, status: "validated", ...json }));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-related-"));
    writeFileSync(join(dir, "project.json"), "{}");
    addDoc("SPEC", SPEC, { title: "Spécification" });
    addDoc("AMD", "# AMD\n\n## 1 Remarque <!-- § 1 -->\n\nVoir SPEC §1 pour la règle.\n", { amends: ["SPEC"] });
    addDoc("OLD", "# OLD\n\n## 1 Ancien <!-- § 1 -->\n\nAncienne règle.\n", {});
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("refInfo", () => {
    it("unknown documents, bare documents, unknown anchors and pages have no title", () => {
      expect(refInfo(dir, "NOPE#§1")).toEqual({ title: "", path: "" });
      expect(refInfo(dir, "SPEC")).toEqual({ title: "Spécification", path: "" });
      expect(refInfo(dir, "OLD")).toEqual({ title: "", path: "" });
      expect(refInfo(dir, "SPEC#§9")).toEqual({ title: "", path: "" });
      expect(refInfo(dir, "SPEC#fig:9")).toEqual({ title: "", path: "" });
      expect(refInfo(dir, "SPEC#page:1")).toEqual({ title: "", path: "" });
    });

    it("a figure before any section has no path; a requirement anchor is no anchor", () => {
      expect(refInfo(dir, "SPEC#fig:1")).toEqual({ title: "Figure 1 – Vue avant toute section", path: "" });
      expect(refInfo(dir, "SPEC#req:EXI_G_1")).toEqual({ title: "", path: "" });
    });
  });

  describe("related — the less common origins", () => {
    it("a bare document id: its amendments", () => {
      const r = related(dir, { ref: "SPEC" });
      expect(r.ref).toBe("SPEC");
      expect(r.neighbours.map((n) => `${n.kind} ${n.direction} ${n.ref}`)).toContain("amends in AMD");
    });

    it("a sub-section is reached by the amendment of its parent section", () => {
      const r = related(dir, { ref: "SPEC#§1.1" });
      expect(r.neighbours.filter((n) => n.kind === "amends").map((n) => n.ref)).toEqual(["AMD", "AMD#§1"]);
    });

    it("refuses a page anchor", () => {
      expect(() => related(dir, { ref: "SPEC#page:1" })).toThrow(/No anchor page:1 in SPEC/);
    });
  });
});
