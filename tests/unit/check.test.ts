import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isStale,
  mechanicalCheck,
  patchReview,
  recordSemantic,
  runMechanical,
  setReview,
} from "../../src/core/lib/check.ts";
import { testHash } from "../../src/core/lib/hash.ts";
import { readCheck, readTest } from "../../src/core/lib/store.ts";
import { normalizeAnchor } from "../../src/core/rag/anchors.ts";
import type { Finding } from "../../src/core/types.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
const DOC = "SOSIE_211_D401-1_3";
let project = "";

const testFile = (id: string) => join(project, "tests", id, "test.md");
const docFile = (id: string, f: string) => join(project, "docs", id, f);
const edit = (file: string, from: string | RegExp, to: string) => {
  const s = readFileSync(file, "utf8");
  const t = s.replace(from, to);
  if (s === t) throw new Error(`edit did not apply in ${file}: ${from}`);
  writeFileSync(file, t);
};
const kinds = (fs: Finding[]) => fs.map((f) => `${f.step ?? "-"}:${f.kind}:${f.severity}`);
const check1398 = () => mechanicalCheck(project, "LFRPS12-1398");

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-check-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
});

describe("mechanical check — the fixture", () => {
  it("LFRPS12-1398 is clean", () => {
    expect(check1398()).toEqual([]);
  });

  it("LFRPS12-1420: only step 5 lacks a source (quotes under § and fig anchors are found)", () => {
    expect(kinds(mechanicalCheck(project, "LFRPS12-1420"))).toEqual(["5:source-missing:warning"]);
    expect(mechanicalCheck(project, "LFRPS12-1420")[0]).toMatchObject({
      message: expect.stringMatching(/^Step 5 has no source for its expected result/),
      pass: "mechanical",
    });
  });

  it("local-3f9a12c0 is clean", () => {
    expect(mechanicalCheck(project, "local-3f9a12c0")).toEqual([]);
  });
});

describe("mechanical check — sources", () => {
  it("unknown document", () => {
    edit(testFile("LFRPS12-1398"), `${DOC}#§5.6.7`, "SOSIE_999#§5.6.7");
    expect(kinds(check1398())).toEqual(["1:source-missing:error"]);
    expect(check1398()[0].sources).toEqual(["SOSIE_999#§5.6.7"]);
  });

  it("a document is found by its doc.json code as well as its folder name", () => {
    edit(docFile(DOC, "doc.json"), `"code": "${DOC}"`, '"code": "D401-1_3"');
    edit(testFile("LFRPS12-1398"), `${DOC}#§5.6.7`, "D401-1_3#§5.6.7");
    expect(check1398()).toEqual([]);
  });

  it("an old superseded mark in doc.json no longer stops a citation", () => {
    edit(
      docFile(DOC, "doc.json"),
      '"status": "validated"',
      '"status": "superseded", "supersededBy": "SOSIE_211_D401-1_3b"',
    );
    expect(check1398()).toEqual([]);
  });

  it("missing anchor, for each anchor kind", () => {
    edit(testFile("LFRPS12-1398"), "#§5.6.7", "#§5.6.9");
    expect(kinds(check1398())).toEqual(["1:source-missing:error"]);
    edit(testFile("LFRPS12-1398"), "#§5.6.9", "#req:EXI_NOPE");
    expect(kinds(check1398())).toContain("1:source-missing:error");
    expect(check1398()[0].message).toContain("has no anchor §req:EXI_NOPE");
    edit(testFile("LFRPS12-1398"), "#req:EXI_NOPE", "#fig:41");
    expect(kinds(check1398())).toContain("1:source-missing:error");
  });

  it("anchors are read in every spelling", () => {
    expect(normalizeAnchor("§ 5.6.6")).toBe("§5.6.6");
    expect(normalizeAnchor("5.6.6")).toBe("§5.6.6");
    expect(normalizeAnchor("fig 40")).toBe("fig:40");
    expect(normalizeAnchor("page:12")).toBe("page:12");
    edit(testFile("LFRPS12-1398"), "#§5.6.7", "#5.6.7");
    expect(check1398()).toEqual([]);
  });

  it("quote not found; case-sensitive", () => {
    edit(testFile("LFRPS12-1398"), "Son menu contextuel propose", "Son menu propose");
    expect(kinds(check1398())).toEqual(["1:quote-not-found:error"]);
    edit(testFile("LFRPS12-1398"), "Son menu propose", "son menu contextuel propose");
    expect(kinds(check1398())).toEqual(["1:quote-not-found:error"]);
  });

  it("quote whitespace-normalised, anchor comments ignored", () => {
    edit(testFile("LFRPS12-1398"), "Son menu contextuel propose", "Son   menu\tcontextuel propose");
    expect(check1398()).toEqual([]);
    edit(docFile(DOC, "doc.md"), "Son menu contextuel propose", "Son menu\n<!-- page 12 -->\ncontextuel propose");
    edit(testFile("LFRPS12-1398"), "Son   menu\tcontextuel propose", "Son menu contextuel propose");
    expect(check1398()).toEqual([]);
  });

  it("bold and italic marks are ignored on both sides of a quote", () => {
    edit(docFile(DOC, "doc.md"), "Son menu contextuel propose", "Son **menu** *contextuel* propose");
    expect(check1398()).toEqual([]);
    edit(testFile("LFRPS12-1398"), "Son menu contextuel propose", "Son **menu contextuel** propose");
    expect(check1398()).toEqual([]);
  });

  it("slug and compound anchors resolve", () => {
    edit(
      docFile(DOC, "doc.md"),
      "<!-- § 5.6.7 -->",
      "<!-- § annexe -->\n\nFigure 18 bis – Menu contextuel du disjoncteur <!-- fig 18-2 -->",
    );
    edit(testFile("LFRPS12-1398"), "#§5.6.7", "#§annexe");
    expect(check1398()).toEqual([]);
    edit(testFile("LFRPS12-1398"), /#§annexe "[^"]*"/, '#fig:18-2 "Figure 18 bis – Menu contextuel du disjoncteur"');
    expect(check1398()).toEqual([]);
  });

  it("a source without a quote is a warning; a malformed line an error", () => {
    edit(testFile("LFRPS12-1398"), / "Son menu contextuel propose Ouvrir, Fermer et Propriétés"/, "");
    expect(kinds(check1398())).toEqual(["1:quote-not-found:warning"]);
    edit(testFile("LFRPS12-1398"), `- ${DOC}#§5.6.7`, "- voir la spec");
    expect(kinds(check1398())).toEqual(["1:source-missing:error"]);
  });
});

describe("mechanical check — steps", () => {
  it("a smart column is free text: whatever it holds raises no finding", () => {
    edit(testFile("local-3f9a12c0"), "EXI_MOP_SPF_511_A_1670", "EXI_MOP_SPF_511_A_1670; EXI_UNKNOWN_1");
    expect(mechanicalCheck(project, "local-3f9a12c0")).toEqual([]);
  });

  it("empty Action and empty Expected Result", () => {
    edit(testFile("LFRPS12-1398"), "Clic droit sur le disjoncteur D 4 de la vue de traction.", "");
    expect(kinds(check1398())).toEqual(["1:empty-field:error"]);
    edit(testFile("LFRPS12-1398"), /### Expected Result\n\nLe menu propose Ouvrir, Fermer et Propriétés.\n/, "");
    expect(kinds(check1398())).toEqual(["1:empty-field:error", "1:empty-field:error"]);
  });

  it("a test with no step", () => {
    writeFileSync(
      testFile("LFRPS12-1398"),
      "---\nproject: LFRPS12\nsummary: x\nreview: draft\n---\n\n## Description\n",
    );
    expect(kinds(check1398())).toEqual(["-:empty-field:error"]);
  });

  it("a raw embed", () => {
    edit(
      testFile("LFRPS12-1398"),
      "Le menu propose Ouvrir, Fermer et Propriétés.",
      "Le menu propose Ouvrir. !xray-attachment://9a7|width=6,height=6!",
    );
    expect(kinds(check1398())).toContain("1:raw-embed:error");
  });

  it("duplicated steps", () => {
    const md = readFileSync(testFile("LFRPS12-1398"), "utf8");
    const step = md.slice(md.indexOf("## Step 1")).replace("## Step 1 <!-- 201 -->", "## Step 2");
    writeFileSync(testFile("LFRPS12-1398"), `${md}\n${step}`);
    expect(kinds(check1398())).toEqual(["2:duplicate-step:warning"]);
  });
});

describe("check.json", () => {
  it("runMechanical writes the findings stamped with the testHash", () => {
    const c = runMechanical(project, "LFRPS12-1420");
    expect(c.testHash).toBe(testHash(readFileSync(testFile("LFRPS12-1420"), "utf8")));
    expect(readCheck(project, "LFRPS12-1420")).toEqual(c);
    expect(isStale(project, "LFRPS12-1420")).toBe(false);
  });

  it("recordSemantic replaces the semantic findings, keeps the mechanical ones, and refreshes staleness", () => {
    expect(isStale(project, "LFRPS12-1420")).toBe(false);
    edit(testFile("LFRPS12-1420"), "Choisir Propriétés.", "Choisir Propriétés dans le menu.");
    expect(isStale(project, "LFRPS12-1420")).toBe(true);
    const c = recordSemantic(project, "LFRPS12-1420", [
      {
        step: 2,
        kind: "wrong-object",
        severity: "error",
        message: "m1",
        sources: [`${DOC}#§5`],
      },
      { kind: "negative-missing", severity: "warning", message: "m0", sources: [] },
    ]);
    expect(c.findings.map((f) => `${f.step ?? "-"}:${f.kind}:${f.pass}`)).toEqual([
      "-:negative-missing:semantic",
      "2:wrong-object:semantic",
      "5:source-missing:mechanical",
    ]);
    expect(isStale(project, "LFRPS12-1420")).toBe(false);
    const again = recordSemantic(project, "LFRPS12-1420", []);
    expect(kinds(again.findings)).toEqual(["5:source-missing:warning"]);
    edit(testFile("LFRPS12-1420"), "Choisir Propriétés dans le menu.", "Choisir Propriétés.");
    expect(isStale(project, "LFRPS12-1420")).toBe(true);
  });
});

describe("review frontmatter", () => {
  it("patchReview changes only frontmatter lines, keeps the body bytes and the other keys", () => {
    const md = readFileSync(testFile("local-3f9a12c0"), "utf8");
    const out = patchReview(md, { review: "checked" });
    expect(out.replace("review: checked", "review: to-fix")).toBe(md);
    const v = patchReview(md, { review: "validated", note: null, by: "s.genin", at: "2026-11-02T10:00:00.000Z" });
    expect(v).toContain(
      "review: validated\nreviewed_by: s.genin\nreviewed_at: 2026-11-02T10:00:00.000Z\ngenerated_by:",
    );
    expect(v).not.toContain("review_note");
    expect(testHash(v)).toBe(testHash(md));
    const crlf = patchReview(md.replace(/\n/g, "\r\n"), { review: "to-fix", note: 'Dire "Propriétés" : seul' });
    expect(crlf).toContain('review_note: "Dire \\"Propriétés\\" : seul"\r\n');
  });

  it("setReview writes the test and parses back", () => {
    const t = setReview(project, "LFRPS12-1420", {
      review: "to-fix",
      note: "Step 2: # pas la bonne exigence",
      by: "a b",
      at: "x",
    });
    expect(t).toMatchObject({ review: "to-fix", reviewNote: "Step 2: # pas la bonne exigence", reviewedBy: "a b" });
    expect(readTest(project, "LFRPS12-1420").test.steps).toHaveLength(5);
  });
});
