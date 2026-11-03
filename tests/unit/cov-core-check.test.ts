import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ userInfo: null as null | (() => { username: string }) }));
vi.mock("node:os", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:os")>();
  return { ...real, userInfo: (...a: []) => (os.userInfo ? os.userInfo() : real.userInfo(...a)) };
});

import {
  anchorKey,
  type Corpus,
  type DocText,
  loadCorpus,
  mechanicalCheck,
  mechanicalFindings,
  occurrences,
  osUser,
  patchReview,
  recordSemantic,
  scopeOf,
  semanticOf,
  setReview,
  testEvidence,
  whereIs,
} from "../../src/core/lib/check.ts";
import type { Finding, Step, Test } from "../../src/core/types.ts";

let dir = "";

const write = (rel: string, text: string) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};
const addDoc = (id: string, md: string, extra: Record<string, unknown> = {}) => {
  write(`docs/${id}/doc.md`, md);
  write(`docs/${id}/doc.json`, JSON.stringify({ id, code: id, title: `Doc ${id}`, status: "validated", ...extra }));
};
const step = (fields: Record<string, string>, sources: Step["sources"] = []): Step => ({
  fields,
  sources,
  images: [],
});
const testOf = (steps: Step[]): Test =>
  ({
    project: "T",
    summary: "s",
    folder: "",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "none",
    steps,
    extra: {},
  }) as unknown as Test;
const docText = (md: string, extra: Partial<DocText> = {}): DocText => ({
  id: "D",
  doc: {},
  anchors: new Set(),
  text: md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim(),
  md,
  scopes: new Map(),
  ...extra,
});
const corpusOf = (d: DocText, field: string | null = null, reqs: string[] = []): Corpus => ({
  docs: new Map([[d.id, d]]),
  requirements: new Set(reqs),
  requirementField: field,
});
const kinds = (fs: Finding[]) => fs.map((f) => `${f.step ?? "-"}:${f.kind}:${f.severity}`);
const testMd = (fm: string[], body: string) => `---\n${fm.join("\n")}\n---\n${body}`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-check-"));
  write("project.json", JSON.stringify({ name: "T", jiraProject: "T" }));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  os.userInfo = null;
  vi.unstubAllEnvs();
});

describe("anchorKey and occurrences", () => {
  it("normalises req/fig/page and § anchors", () => {
    expect(anchorKey(" req EXI_A ")).toBe("req:EXI_A");
    expect(anchorKey("PAGE:3")).toBe("page:3");
    expect(anchorKey("§ 5.6")).toBe("§5.6");
    expect(anchorKey("5.6")).toBe("§5.6");
  });

  it("counts nothing for an empty quote and every non-overlapping hit otherwise", () => {
    expect(occurrences("abc abc", "  ")).toBe(0);
    expect(occurrences("abc abc abc", "abc")).toBe(3);
  });
});

describe("scopeOf", () => {
  const md = [
    "<!-- req EXI_PRE_1 -->",
    "Un texte placé avant tout titre de section.",
    "Encore une ligne avant le titre.",
    "## 1 Premier <!-- § 1 -->",
    "<!-- page 1 -->",
    "Texte de la page un.",
    "Encore la page un.",
    "<!-- page 2 -->",
    "Texte de la page deux.",
    "",
    "Une ligne avant la légende",
    "<!-- fig 3 --> Figure 3 – Schéma",
    "une ligne après la légende",
    "",
    "Hors de la figure.",
  ].join("\n");

  it("a requirement before any heading runs from the top to the first heading", () => {
    expect(scopeOf(md, "req:EXI_PRE_1")).toBe(
      "Un texte placé avant tout titre de section. Encore une ligne avant le titre.",
    );
  });

  it("a page runs to the next page marker", () => {
    expect(scopeOf(md, "page:1")).toBe("Texte de la page un. Encore la page un.");
    expect(scopeOf(md, "page:2")).toContain("Hors de la figure.");
  });

  it("a figure is its whole caption paragraph", () => {
    expect(scopeOf(md, "fig:3")).toBe("Une ligne avant la légende Figure 3 – Schéma une ligne après la légende");
  });

  it("an unknown matrix row or anchor has no scope", () => {
    expect(scopeOf(md, "req:EXI_NONE@matrix")).toBeNull();
    expect(scopeOf(md, "§9")).toBeNull();
  });

  it("a § marker outside a heading runs to the next section heading", () => {
    const inline = ["## 1 A <!-- § 1 -->", "Texte en ligne <!-- § 4 -->", "suite", "## 2 B <!-- § 2 -->", "après"].join(
      "\n",
    );
    expect(scopeOf(inline, "§4")).toBe("Texte en ligne suite");
  });

  it("a requirement at the top of a document without headings runs to its end", () => {
    expect(scopeOf("<!-- req EXI_A_1 -->\nseul texte du document", "req:EXI_A_1")).toBe("seul texte du document");
  });
});

describe("whereIs", () => {
  it("finds a quote in a multi-line figure caption paragraph", () => {
    const d = docText(
      ["## 1 Titre <!-- § 1 -->", "", "avant la légende", "<!-- fig 7 --> Figure 7 – Plan", "suite"].join("\n"),
    );
    expect(whereIs(d, "Figure 7 – Plan suite")).toBe("§1");
    expect(whereIs(d, "absent de partout")).toBeNull();
  });
});

describe("mechanicalFindings — the less common branches", () => {
  it("steps without an Action or Expected key, and two empty steps are not duplicates", () => {
    const d = docText("## 1 X <!-- § 1 -->");
    const fs = mechanicalFindings(testOf([step({}), step({})]), corpusOf(d));
    expect(kinds(fs)).toEqual([
      "1:empty-field:error",
      "1:empty-field:error",
      "2:empty-field:error",
      "2:empty-field:error",
    ]);
  });

  it("an anchor the md does not hold falls back to the whole text", () => {
    const d = docText("## 1 X <!-- § 1 -->\nLe texte de la section est assez long ici.", {
      anchors: new Set(["§1", "§9"]),
    });
    const fs = mechanicalFindings(
      testOf([
        step({ Action: "a", "Expected Result": "b" }, [
          { docId: "D", anchor: "§9", quote: "Le texte de la section est assez long ici." },
        ]),
      ]),
      corpusOf(d),
    );
    expect(fs).toEqual([]);
  });

  it("a quote across two sections is in the document but under no section", () => {
    const md = [
      "## 1 Un <!-- § 1 -->",
      "fin de la section un",
      "## 2 Deux <!-- § 2 -->",
      "début de la section deux",
    ].join("\n");
    const d = docText(md, { anchors: new Set(["§1", "§2"]) });
    const fs = mechanicalFindings(
      testOf([
        step({ Action: "a", "Expected Result": "b" }, [
          { docId: "D", anchor: "§1", quote: "fin de la section un ## 2 Deux début de la section" },
        ]),
      ]),
      corpusOf(d),
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ kind: "quote-not-at-anchor", sources: ["D#§1"] });
    expect(fs[0].message).toMatch(/cite the section that holds it\.$/);
  });

  it("a quote repeated under its anchor is weak", () => {
    const md = [
      "## 1 Un <!-- § 1 -->",
      "le voyant rouge reste allumé en permanence.",
      "le voyant rouge reste allumé en permanence.",
    ].join("\n");
    const d = docText(md, { anchors: new Set(["§1"]) });
    const fs = mechanicalFindings(
      testOf([
        step({ Action: "a", "Expected Result": "b" }, [
          { docId: "D", anchor: "§1", quote: "le voyant rouge reste allumé en permanence" },
        ]),
      ]),
      corpusOf(d),
    );
    expect(kinds(fs)).toEqual(["1:quote-weak:warning"]);
    expect(fs[0].message).toContain("appears 2 times under §1");
  });

  it("a long quote is shortened in the message", () => {
    const d = docText("## 1 Un <!-- § 1 -->\ncourt", { anchors: new Set(["§1"]) });
    const long = "x".repeat(80);
    const fs = mechanicalFindings(
      testOf([step({ Action: "a", "Expected Result": "b" }, [{ docId: "D", anchor: "§1", quote: long }])]),
      corpusOf(d),
    );
    expect(fs[0].message).toContain(`"${"x".repeat(57)}…"`);
  });

  it("requirement ids are checked only when the project has a requirement field", () => {
    const d = docText("## 1 X <!-- § 1 -->");
    const t = testOf([step({ Action: "a", "Expected Result": "", Exigence: "EXI_A_1, EXI_B_2" })]);
    expect(kinds(mechanicalFindings(t, corpusOf(d, "Exigence", ["EXI_A_1"])))).toEqual([
      "1:empty-field:error",
      "1:requirement-unknown:error",
    ]);
    expect(kinds(mechanicalFindings(t, corpusOf(d, null)))).toEqual(["1:empty-field:error"]);
  });
});

describe("loadCorpus", () => {
  it("without docs, requirements nor xray fields, ignoring files and folders without doc.md", () => {
    const c = loadCorpus(dir);
    expect(c.docs.size).toBe(0);
    expect([...c.requirements]).toEqual([]);
    expect(c.requirementField).toBeNull();
  });

  it("reads the requirement column by its header (else the first), skips bad patterns, files and empty folders", () => {
    write("project.json", JSON.stringify({ name: "T", requirementPatterns: ["[", String.raw`\bREQ-\d+`] }));
    write("requirements/requirements.csv", "Titre;Exigence\nun;EXI_CSV_1\ndeux;\nsolo\n");
    write("docs/readme.txt", "not a doc");
    mkdirSync(join(dir, "docs", "EMPTY"), { recursive: true });
    addDoc("D1", "## 1 X <!-- § 1 -->\nLa règle REQ-42 s'applique.\n");
    addDoc("D2", "## 1 Y <!-- § 1 -->\n", { code: "D1" });
    const c = loadCorpus(dir);
    expect([...c.docs.keys()].sort()).toEqual(["D1", "D2"]);
    expect(c.docs.get("D1")?.id).toBe("D1");
    expect([...c.requirements].sort()).toEqual(["EXI_CSV_1", "REQ-42"]);

    write("requirements/requirements.csv", "A;B\nEXI_FIRST_1;x\n;y\n");
    expect([...loadCorpus(dir).requirements]).toContain("EXI_FIRST_1");
  });

  it("names the requirement field from project.json first, then a custom xray field, then a builtin one", () => {
    write("project.json", JSON.stringify({ name: "T", requirementField: "  Req  " }));
    expect(loadCorpus(dir).requirementField).toBe("Req");
    write("project.json", JSON.stringify({ name: "T", requirementField: "  " }));
    write("xray.json", JSON.stringify({ fields: [{ id: "r", name: "Requirement", type: "text", builtin: true }] }));
    expect(loadCorpus(dir).requirementField).toBe("Requirement");
  });
});

describe("requirement links: related-unread and test evidence", () => {
  const MD = [
    "# SPEC — Spécification",
    "",
    "## 1 Général <!-- § 1 -->",
    "",
    "<!-- req EXI_LNK_1 -->",
    "La vue détaillée s'ouvre par un double clic sur le poste.",
    "",
    "## <!-- § 2 -->",
    "",
    "Texte sans titre qui cite EXI_LNK_1 dans le corps.",
    "",
    "## 3 Matrice <!-- § 3 -->",
    "",
    "| Exigence | Section | Objet |",
    "| --- | --- | --- |",
    "| EXI_LNK_1 | 2 | La vue détaillée |",
    "",
    "## 4 Annexe <!-- § 4 -->",
    "",
    "Rien ici.",
  ].join("\n");

  const testWith = (exigences: string[]) =>
    testMd(
      ["project: T", "summary: s", "folder: /", "labels: []", "review: none", "generated_by: gen-1"],
      `\n## Description\n\nd\n\n${exigences
        .map(
          (e, i) =>
            `## Step ${i + 1}\n\n### Action\n\na\n\n### Expected Result\n\nb\n\n### Exigence\n\n${e}\n\n### Sources\n\n- SPEC#§1 "La vue détaillée s'ouvre par un double clic sur le poste."\n`,
        )
        .join("\n")}`,
    );

  beforeEach(() => {
    write(
      "xray.json",
      JSON.stringify({
        fields: [
          { id: "action", name: "Action", type: "text", builtin: true },
          { id: "result", name: "Expected Result", type: "text", builtin: true },
          { id: "cf", name: "Exigence", type: "text", builtin: false },
        ],
      }),
    );
    addDoc("SPEC", MD);
    write("tests/T-1/test.md", testWith(["EXI_LNK_1", "EXI_LNK_1 EXI_NOWHERE_9"]));
    write(".testimus/gen/gen-1.json", JSON.stringify({ consulted: ["SPEC#§3"], searched: [] }));
  });

  it("names the defining and the traced sections never opened, once each, skipping unknown requirements", () => {
    const unread = mechanicalCheck(dir, "T-1").filter((f) => f.kind === "related-unread");
    expect(unread.map((f) => f.message)).toEqual([
      "Step 1: EXI_LNK_1 is defined in SPEC#§1 (Général), which the generation gen-1 never opened.",
      "Step 1: EXI_LNK_1 is traced in SPEC#§2, which the generation gen-1 never opened.",
    ]);
  });

  it("without a requirement field no link is drawn", () => {
    write("xray.json", JSON.stringify({ fields: [{ id: "action", name: "Action", type: "text", builtin: true }] }));
    expect(mechanicalCheck(dir, "T-1").filter((f) => f.kind === "related-unread")).toEqual([]);
    const e = testEvidence(dir, "T-1");
    expect(e.related).toEqual([]);
    expect(e.read).toEqual([{ ref: "SPEC#§3", title: "Matrice", cited: false }]);
  });

  it("test evidence lists the links with what was read, not what an amendment points at", () => {
    addDoc("AMD", "# AMD\n\n## 1 Remarque <!-- § 1 -->\n\nVoir SPEC §4 pour le détail.\n", { amends: ["SPEC"] });
    write("tests/T-1/test.md", testWith(["EXI_LNK_1", "AMD#§1"]));
    const e = testEvidence(dir, "T-1");
    expect(e.related.some((r) => r.ref === "SPEC#§4" && r.kind === "amends")).toBe(false);
    expect(e.jobId).toBe("gen-1");
    expect(e.related.map((r) => `${r.kind} ${r.ref} ${r.read}`)).toEqual(
      expect.arrayContaining(["defines SPEC#§1 false", "traces SPEC#§2 false"]),
    );
  });
});

describe("patchReview and setReview", () => {
  const MD = testMd(
    ["project: T", "review: to-fix", "review_note: |", "  première ligne", "  deuxième ligne", "summary: s"],
    "\nbody\n",
  );

  it("drops the continuation lines of a replaced key and quotes values YAML would misread", () => {
    const out = patchReview(MD, { review: "validated", note: null, by: " lead", at: "[x]" });
    expect(out).toBe(
      testMd(
        ["project: T", "review: validated", 'reviewed_by: " lead"', 'reviewed_at: "[x]"', "summary: s"],
        "\nbody\n",
      ),
    );
    expect(patchReview(MD, { review: "validated", by: '"q"', at: "a #b" })).toContain('reviewed_by: "\\"q\\""');
    expect(patchReview(MD, { review: "validated", by: "plain" })).toContain("reviewed_by: plain");
  });

  it("appends the review keys when the frontmatter has none", () => {
    const md = testMd(["project: T", "summary: s"], "\nbody\n");
    expect(patchReview(md, { review: "validated" })).toBe(
      testMd(["project: T", "summary: s", "review: validated"], "\nbody\n"),
    );
  });

  it("refuses a test.md without frontmatter", () => {
    expect(() => patchReview("no frontmatter here", { review: "validated" })).toThrow(/no readable frontmatter/);
  });

  it("setReview refuses a test that does not exist", () => {
    expect(() => setReview(dir, "NOPE-1", { review: "validated" })).toThrow(/No test NOPE-1/);
  });

  it("semanticOf of no check is empty", () => {
    expect(semanticOf(null)).toEqual([]);
  });
});

describe("recordSemantic", () => {
  it("a semantic finding without sources gets an empty list", () => {
    write(
      "tests/T-2/test.md",
      testMd(
        ["project: T", "summary: s", "review: none"],
        "\n## Step 1\n\n### Action\n\na\n\n### Expected Result\n\nb\n",
      ),
    );
    const file = recordSemantic(dir, "T-2", [
      { kind: "ambiguous", severity: "warning", message: "m" } as unknown as Omit<Finding, "pass">,
    ]);
    expect(file.findings.find((f) => f.pass === "semantic")).toMatchObject({ sources: [], message: "m" });
  });
});

describe("osUser", () => {
  it("uses the OS account, else USERNAME, else unknown", () => {
    os.userInfo = () => ({ username: "alice" });
    expect(osUser()).toBe("alice");
    os.userInfo = () => ({ username: "" });
    vi.stubEnv("USERNAME", "bob");
    expect(osUser()).toBe("bob");
    vi.stubEnv("USERNAME", "");
    expect(osUser()).toBe("unknown");
  });

  it("falls back to USERNAME, USER, then unknown when the OS cannot say", () => {
    os.userInfo = () => {
      throw new Error("no passwd entry");
    };
    vi.stubEnv("USERNAME", "carol");
    expect(osUser()).toBe("carol");
    vi.stubEnv("USERNAME", "");
    vi.stubEnv("USER", "dave");
    expect(osUser()).toBe("dave");
    vi.stubEnv("USER", "");
    expect(osUser()).toBe("unknown");
  });
});
