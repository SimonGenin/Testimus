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
  type Corpus,
  type DocText,
  loadCorpus,
  mechanicalFindings,
  occurrences,
  recordSemantic,
  scopeOf,
  semanticOf,
  whereIs,
} from "../../../../src/core/lib/check.ts";
import { osUser, patchReview, setReview } from "../../../../src/core/lib/review.ts";
import { normalizeAnchor } from "../../../../src/core/rag/anchors.ts";
import type { Finding, Step, Test } from "../../../../src/core/types.ts";

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
const corpusOf = (d: DocText): Corpus => ({ docs: new Map([[d.id, d]]) });
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

describe("anchors (normalizeAnchor) and occurrences", () => {
  it("normalises fig/page and § anchors; anything else is a section", () => {
    expect(normalizeAnchor(" fig 4 ")).toBe("fig:4");
    expect(normalizeAnchor("PAGE:3")).toBe("page:3");
    expect(normalizeAnchor("req:EXI_A")).toBe("§req:EXI_A");
    expect(normalizeAnchor("§ 5.6")).toBe("§5.6");
    expect(normalizeAnchor("5.6")).toBe("§5.6");
  });

  it("counts nothing for an empty quote and every non-overlapping hit otherwise", () => {
    expect(occurrences("abc abc", "  ")).toBe(0);
    expect(occurrences("abc abc abc", "abc")).toBe(3);
  });
});

describe("scopeOf", () => {
  const md = [
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

  it("a page runs to the next page marker", () => {
    expect(scopeOf(md, "page:1")).toBe("Texte de la page un. Encore la page un.");
    expect(scopeOf(md, "page:2")).toContain("Hors de la figure.");
  });

  it("a figure is its whole caption paragraph", () => {
    expect(scopeOf(md, "fig:3")).toBe("Une ligne avant la légende Figure 3 – Schéma une ligne après la légende");
  });

  it("an unknown anchor has no scope", () => {
    expect(scopeOf(md, "fig:99")).toBeNull();
    expect(scopeOf(md, "§9")).toBeNull();
  });

  it("a § marker outside a heading runs to the next section heading", () => {
    const inline = ["## 1 A <!-- § 1 -->", "Texte en ligne <!-- § 4 -->", "suite", "## 2 B <!-- § 2 -->", "après"].join(
      "\n",
    );
    expect(scopeOf(inline, "§4")).toBe("Texte en ligne suite");
  });

  it("a page at the top of a document without headings runs to its end", () => {
    expect(scopeOf("<!-- page 1 -->\nseul texte du document", "page:1")).toBe("seul texte du document");
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

  it("a smart column is free text: what it holds raises no finding", () => {
    const d = docText("## 1 X <!-- § 1 -->");
    const t = testOf([step({ Action: "a", "Expected Result": "", Exigence: "EXI_A_1, EXI_B_2" })]);
    expect(kinds(mechanicalFindings(t, corpusOf(d)))).toEqual(["1:empty-field:error"]);
  });
});

describe("loadCorpus", () => {
  it("without docs, ignoring files and folders without doc.md", () => {
    expect(loadCorpus(dir).docs.size).toBe(0);
  });

  it("a document answers by its folder and by its code, the first one keeping a code", () => {
    write("docs/readme.txt", "not a doc");
    mkdirSync(join(dir, "docs", "EMPTY"), { recursive: true });
    addDoc("D1", "## 1 X <!-- § 1 -->\nLa règle s'applique.\n");
    addDoc("D2", "## 1 Y <!-- § 1 -->\n", { code: "D1" });
    addDoc("D3", "## 1 Z <!-- § 1 -->\n", { code: "C3" });
    const c = loadCorpus(dir);
    expect([...c.docs.keys()].sort()).toEqual(["C3", "D1", "D2", "D3"]);
    expect(c.docs.get("D1")?.id).toBe("D1");
    expect(c.docs.get("C3")?.id).toBe("D3");
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
