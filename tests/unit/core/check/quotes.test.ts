import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadCorpus, mechanicalFindings, scopeOf, tooShort } from "../../../../src/core/lib/check.ts";
import { parseTest } from "../../../../src/core/lib/testfile.ts";

const corpus = loadCorpus(resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project"));
const DOC = "SOSIE_211_D401-1_3";

const findings = (...sources: string[]) =>
  mechanicalFindings(
    parseTest(
      `---\nproject: LFRPS12\nsummary: S\n---\n\n## Step 1\n\n### Action\n\nOuvrir\n\n### Expected Result\n\nVu\n\n### Sources\n\n${sources.map((s) => `- ${DOC}#${s}`).join("\n")}\n`,
    ).test,
    corpus,
  )
    .filter((f) => f.kind !== "figure-not-embedded")
    .map((f) => `${f.severity}:${f.message.replace(/^Step 1: /, "")}`);

const S5 = '"La schématique de traction occupe la partie basse"';
const S566 = '"Selon le type de sectionneur, le menu contextuel diffère"';
const S567 = '"Le disjoncteur est commandé à distance depuis le PCC"';

describe("minor 3 — a quote must be under the anchor it cites", () => {
  test("a §5 sentence cited as §5.6.6 is an error; a §5.6.6 sentence cited as §5 is fine (subsections count)", () => {
    expect(findings(`§5.6.6 ${S5}`)).toEqual([
      `error:the quote "La schématique de traction occupe la partie basse" is in ${DOC} but not under §5.6.6: it is under §5 — cite ${DOC}#§5.`,
    ]);
    expect(findings(`§5 ${S566}`)).toEqual([]);
    expect(findings(`§5.6.6 ${S567}`)).toHaveLength(1);
    expect(findings(`§5.6.7 ${S567}`)).toEqual([]);
  });

  test("an old req: citation is no anchor of the document", () => {
    expect(findings(`req:EXI_MOP_SPF_511_A_1650 ${S566}`)).toEqual([
      `error:${DOC} has no anchor §req:EXI_MOP_SPF_511_A_1650: cite an existing section, figure or page.`,
    ]);
  });

  test("fig: is its caption paragraph only", () => {
    expect(findings('fig:40 "Figure 40 – Représentation graphique sectionneur"')).toEqual([]);
    expect(findings(`fig:40 ${S566}`)).toEqual([expect.stringMatching(/not under fig:40: it is under §5.6.6/)]);
    expect(findings(`fig:40 ${S5}`)).toEqual([expect.stringMatching(/not under fig:40/)]);
  });

  test("scopeOf: unknown anchor → null; § scope stops at the next sibling", () => {
    const md = corpus.docs.get(DOC)!.md;
    expect(scopeOf(md, "§9.9")).toBeNull();
    const s = scopeOf(md, "§5.6.6")!;
    expect(s.startsWith("#### 5.6.6 Sectionneur (S)")).toBe(true);
    expect(s).not.toContain("Disjoncteur");
  });
});

describe("minor 3 — a trivial quote proves nothing", () => {
  test("“de” and “sectionneur” are warnings, not passes", () => {
    expect(findings('§5 "de"', '§5.6.6 "sectionneur"')).toEqual([
      `warning:the quote "de" is too short to prove anything: quote at least 4 words (20 characters) of ${DOC}#§5.`,
      `warning:the quote "sectionneur" is too short to prove anything: quote at least 4 words (20 characters) of ${DOC}#§5.6.6.`,
    ]);
  });

  test("the thresholds: fewer than 4 words or fewer than 20 characters", () => {
    expect(tooShort("Le sectionneur est")).toBe(true);
    expect(tooShort("a b c d")).toBe(true);
    expect(tooShort("Le sectionneur est représenté")).toBe(false);
  });
});

const EVID = loadCorpus(resolve(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project"));
const evid = (...sources: string[]) =>
  mechanicalFindings(
    parseTest(
      `---\nproject: EVID\nsummary: S\n---\n\n## Step 1\n\n### Action\n\nOuvrir\n\n### Expected Result\n\nVu\n\n### Sources\n\n${sources.map((s) => `- SPEC_A#${s}`).join("\n")}\n`,
    ).test,
    EVID,
  )
    .filter((f) => f.kind !== "figure-not-embedded")
    .map((f) => ({
      kind: f.kind,
      severity: f.severity,
      message: f.message.replace(/^Step 1: /, ""),
      sources: f.sources,
    }));

describe("R2 — the quote is looked for in the cited passage", () => {
  test("found elsewhere: quote-not-at-anchor, naming the anchor that holds it", () => {
    expect(evid('§3.2 "La vue ligne se rafraîchit toutes les secondes"')).toEqual([
      {
        kind: "quote-not-at-anchor",
        severity: "error",
        message:
          'the quote "La vue ligne se rafraîchit toutes les secondes" is in SPEC_A but not under §3.2: it is under §2.1 — cite SPEC_A#§2.1.',
        sources: ["SPEC_A#§3.2", "SPEC_A#§2.1"],
      },
    ]);
  });

  test("a table row is text of its section like any other", () => {
    expect(evid('§6.1 "Le simulateur enregistre chaque commande"')).toEqual([]);
    expect(evid('§2.1 "Les commandes refusées sont signalées"')[0]).toMatchObject({
      kind: "quote-not-at-anchor",
      message: expect.stringMatching(/it is under §6\.1 — cite SPEC_A#§6\.1\.$/),
    });
  });

  test("a figure source proves its caption only", () => {
    expect(evid('fig:1 "Figure 1 – Vue ligne complète"')).toEqual([]);
    expect(evid('fig:1 "La vue ligne se rafraîchit toutes les secondes"')[0].kind).toBe("quote-not-at-anchor");
  });

  test("not in the document at all: still quote-not-found", () => {
    expect(evid('§2.1 "Une phrase que le document ne contient pas"').map((f) => f.kind)).toEqual(["quote-not-found"]);
  });
});

describe("R2 — weak quotes", () => {
  test("fewer than 4 words: quote-weak warning", () => {
    expect(evid('§2.1 "vue ligne"')).toEqual([
      expect.objectContaining({ kind: "quote-weak", severity: "warning", message: expect.stringMatching(/too short/) }),
    ]);
  });

  test("found more than once in its passage: quote-weak warning", () => {
    expect(evid('§2.1 "Le poste clignote en cas de défaut"')).toEqual([
      {
        kind: "quote-weak",
        severity: "warning",
        message:
          'the quote "Le poste clignote en cas de défaut" appears 2 times under §2.1: quote more words so it points at one place.',
        sources: ["SPEC_A#§2.1"],
      },
    ]);
    expect(evid('§2.1 "Le poste clignote en cas de défaut. Le poste clignote"')).toEqual([]);
  });
});
