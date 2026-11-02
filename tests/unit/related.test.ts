import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import { type Related, related, statementOf } from "../../src/core/rag/related.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "evidence", "project");
let dir: string;

function addDoc(id: string, md: string, extra: Record<string, unknown> = {}) {
  mkdirSync(join(dir, "docs", id), { recursive: true });
  writeFileSync(join(dir, "docs", id, "doc.md"), md);
  writeFileSync(
    join(dir, "docs", id, "doc.json"),
    JSON.stringify({ id, code: id, title: `Doc ${id}`, status: "validated", binding: "mandatory", ...extra }),
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
      "Comme le demande EXI_MOP_SPF_100_A_20, la vue se rafraîchit (voir SPEC_A §2.2).",
    ].join("\n"),
  );
  addDoc("OLD", "# OLD — O\n\n## 1 X <!-- § 1 -->\n\nVoir SPEC_A §2.1.\n", { status: "superseded" });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const of = (r: Related, kind: string, direction?: "in" | "out", depth = 1) =>
  r.neighbours
    .filter((n) => n.kind === kind && (!direction || n.direction === direction) && n.depth === depth)
    .map((n) => n.ref);

describe("rag.related (SPEC-RAG §3.3, §4.1)", () => {
  it("a requirement: its statement, defining and traced sections, the sections that mention it, the amending document", () => {
    const r = related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_100_A_40" });
    expect(r.ref).toBe("SPEC_A#req:EXI_MOP_SPF_100_A_40");
    expect(r.statement).toEqual({
      id: "EXI_MOP_SPF_100_A_40",
      source: "body",
      section: "SPEC_A#§2.2",
      text: "**EXI_MOP_SPF_100_A_40**\n\nLa vue détaillée s'ouvre par un double clic sur le poste.",
    });
    expect(of(r, "defines", "out")).toEqual(["SPEC_A#§2.2"]);
    expect(of(r, "traces", "out")).toEqual(["SPEC_A#§3.2"]);
    expect(of(r, "mentions", "in")).toEqual(["SPEC_A#§2.2", "SPEC_A#§6.1"]);
    expect(of(r, "amends", "in")).toEqual(["PA1_SPEC_A"]);
    expect(r.neighbours.find((n) => n.ref === "SPEC_A#§3.2")).toMatchObject({ title: "Ouverture", path: "3 > 3.2" });
  });

  it("warns when the matrix traces a requirement elsewhere than where it is defined (an ancestor is fine)", () => {
    expect(related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_100_A_40" }).warnings).toEqual([
      "EXI_MOP_SPF_100_A_40: traced to SPEC_A#§3.2 but defined in SPEC_A#§2.2 — the matrix and the body may disagree.",
    ]);
    expect(related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_100_A_10" }).warnings).toEqual([]);
  });

  it("a bare requirement id: every document that carries it", () => {
    const r = related(dir, { ref: "EXI_MOP_SPF_100_A_20" });
    expect(r.ref).toBe("EXI_MOP_SPF_100_A_20");
    expect(r.statement?.section).toBe("SPEC_A#§2.1");
    expect(of(r, "defines", "out").sort()).toEqual(["SPEC_A#§2.1", "SPEC_C#§7"]);
    expect(of(r, "traces", "out").sort()).toEqual(["SPEC_A#§1.1", "SPEC_A#§2"]);
    expect(r.warnings.join(" ")).toMatch(/traced to SPEC_A#§1\.1/);
    expect(statementOf(dir, "EXI_MOP_SPF_100_A_20")).toMatchObject({
      docId: "SPEC_A",
      section: "§2.1",
      path: "2 > 2.1",
    });
  });

  it("a section: parent, children, siblings, cross-references both ways, figures, requirements, amendments", () => {
    const r = related(dir, { ref: "SPEC_A#§2.1" });
    expect(of(r, "parent", "out")).toEqual(["SPEC_A#§2"]);
    expect(of(r, "sibling")).toEqual(["SPEC_A#§2.2", "SPEC_A#§2.2"]);
    expect(of(r, "refers", "in")).toEqual(["SPEC_A#§1", "SPEC_A#§2.2"]);
    expect(of(r, "shows", "out")).toEqual(["SPEC_A#fig:1"]);
    expect(of(r, "defines", "in")).toEqual(["SPEC_A#req:EXI_MOP_SPF_100_A_10", "SPEC_A#req:EXI_MOP_SPF_100_A_20"]);
    expect(of(r, "mentions", "out")).toEqual(["SPEC_A#req:EXI_MOP_SPF_100_A_10", "SPEC_A#req:EXI_MOP_SPF_100_A_20"]);
    expect(of(r, "amends", "in")).toEqual(["PA1_SPEC_A", "PA1_SPEC_A#§commentaires-majeurs"]);
    expect(r.neighbours.find((n) => n.ref === "SPEC_A#fig:1")?.title).toBe("Figure 1 – Vue ligne complète");
    expect(of(related(dir, { ref: "SPEC_A#§2" }), "parent", "in")).toEqual(["SPEC_A#§2.1", "SPEC_A#§2.2"]);
    expect(of(related(dir, { ref: "SPEC_B#§4.1" }), "refers", "in")).toEqual(["SPEC_A#§2.2"]);
  });

  it("an amendment reaches the sub-sections of the section it amends", () => {
    addDoc("PA2", "# PA2 — P\n\n## Remarques <!-- § remarques -->\n\nP3 § 2 : revoir l'affichage.\n", {
      amends: ["SPEC_A"],
    });
    expect(of(related(dir, { ref: "SPEC_A#§2.2" }), "amends", "in")).toContain("PA2#§remarques");
  });

  it("a figure and a matrix row", () => {
    expect(of(related(dir, { ref: "SPEC_A#fig:1" }), "shows", "in")).toEqual(["SPEC_A#§2.1"]);
    const row = related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_900_A_2@matrix" });
    expect(row.ref).toBe("SPEC_A#req:EXI_MOP_SPF_900_A_2");
    expect(row.statement?.source).toBe("matrix");
  });

  it("depth 2 adds the neighbours of the neighbours, once, after depth 1", () => {
    const one = related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_100_A_10" });
    const two = related(dir, { ref: "SPEC_A#req:EXI_MOP_SPF_100_A_10", depth: 2 });
    expect(two.neighbours.slice(0, one.neighbours.length)).toEqual(one.neighbours);
    expect(of(two, "shows", "out", 2)).toEqual(["SPEC_A#fig:1"]);
    expect(of(two, "parent", "out", 2)).toContain("SPEC_A#§2");
    const depth1 = new Set(one.neighbours.map((n) => n.ref));
    for (const n of two.neighbours.filter((x) => x.depth === 2)) expect(depth1.has(n.ref)).toBe(false);
  });

  it("never returns a superseded document", () => {
    expect(of(related(dir, { ref: "SPEC_A#§2.1" }), "refers", "in")).not.toContain("OLD#§1");
  });

  it("refuses what does not exist", () => {
    expect(() => related(dir, { ref: "NOPE#§1" })).toThrow(/No document NOPE/);
    expect(() => related(dir, { ref: "SPEC_A#§9.9" })).toThrow(/No anchor §9\.9/);
    expect(() => related(dir, { ref: "EXI_UNKNOWN_1" })).toThrow(/No document carries/);
  });

  it("gives the same neighbours with and without the index", async () => {
    const cases = ["SPEC_A#§2.1", "EXI_MOP_SPF_100_A_20", "SPEC_A#req:EXI_MOP_SPF_100_A_40"];
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
    const { mcpAccess } = await import("../../src/core/claude/run.ts");
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
        join(import.meta.dirname, "..", "..", "templates", "project", ".claude", "skills", n, "SKILL.md"),
        "utf8",
      );
    for (const n of ["generate-tests", "check-test", "ask-docs", "fix-test"]) {
      expect(skill(n), n).toMatch(/rag_mentions/);
      expect(skill(n), n).toMatch(/rag_related/);
      expect(skill(n), n).toMatch(/^---\nname: /);
    }
    expect(skill("generate-tests")).toMatch(/"consulted": \[/);
    expect(skill("check-test")).toMatch(/`Read` the image/);
    expect(skill("ask-docs")).toMatch(/only after `rag_mentions` and `rag_related` found nothing/);
  });
});
