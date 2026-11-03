import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expand, expandTerm, glossaryOf, parseGlossary } from "../../../../src/core/rag/glossary.ts";

describe("the glossary", () => {
  const MD = `# 1 Introduction <!-- § 1 -->

## 1.3 Documents <!-- § 1.3 -->

| Code | Titre |
| --- | --- |
| DA45 | Poste de Traction Local (PTL) |

## 1.4 Acronymes <!-- § 1.4 -->

| Acronyme | Signification |
| --- | --- |
| DSO | Départ Sur Ordre |
| DA | Document Applicable (§1.2) ; Disjonction d’Alarme |
| R³ / RRR | RealRailroad (module de simulation) |
| S | Sectionneur |
| **IHM** | Interface Homme-Machine |
| Sectionneur | appareil de coupure |

### 1.4.1 Autres sigles <!-- § 1.4.1 -->

- DHT : Disjoncteur Haute Tension
- PCC – Poste de Commande et de Contrôle Centralisés
SIt\tSectionneur d’Isolement télécommandé
Le présent document emploie aussi les termes suivants : voir plus haut.

## 1.5 Abréviations <!-- § 1.5 -->

GTc = Gestionnaire de Terminus classique

## 2 Fonctions <!-- § 2 -->

| Sigle | Sens |
| --- | --- |
| XYZ | Hors glossaire |
NOPE : pas un sigle du glossaire
`;

  describe("glossary parsing", () => {
    const g = parseGlossary(MD, "D");
    const of = (abbr: string) => g.filter((e) => e.abbr === abbr).map((e) => e.long);

    it("reads tables of sections titled Acronymes, Abréviations, Glossaire and their subsections", () => {
      expect(of("DSO")).toEqual(["Départ Sur Ordre"]);
      expect(of("IHM")).toEqual(["Interface Homme-Machine"]);
      expect(g.find((e) => e.abbr === "DSO")?.source).toBe("D#§1.4");
      expect(g.find((e) => e.abbr === "GTc")?.source).toBe("D#§1.5");
    });

    it("splits several meanings and several acronyms, drops parentheses", () => {
      expect(of("DA")).toEqual(["Document Applicable", "Disjonction d’Alarme"]);
      expect(of("R³")).toEqual(["RealRailroad"]);
      expect(of("RRR")).toEqual(["RealRailroad"]);
      expect(of("S")).toEqual(["Sectionneur"]);
    });

    it("reads « SIGLE : forme », « SIGLE – forme », tab and = lines", () => {
      expect(of("DHT")).toEqual(["Disjoncteur Haute Tension"]);
      expect(of("PCC")).toEqual(["Poste de Commande et de Contrôle Centralisés"]);
      expect(of("SIt")).toEqual(["Sectionneur d’Isolement télécommandé"]);
      expect(of("GTc")).toEqual(["Gestionnaire de Terminus classique"]);
    });

    it("skips header rows, plain words, prose and other sections", () => {
      expect(of("Acronyme")).toEqual([]);
      expect(of("Sectionneur")).toEqual([]);
      expect(of("DA45")).toEqual([]);
      expect(of("XYZ")).toEqual([]);
      expect(of("NOPE")).toEqual([]);
      expect(g.some((e) => e.abbr.startsWith("Le présent"))).toBe(false);
    });
  });

  describe("expansion", () => {
    const g = parseGlossary(MD, "D");

    it("expands both ways: acronym → long form, long form (any inflection) → acronym", () => {
      expect(expand(g, "DSO")).toEqual(["Départ Sur Ordre"]);
      expect(expand(g, "dso")).toEqual(["Départ Sur Ordre"]);
      expect(expand(g, "les disjoncteurs haute tension ouverts")).toEqual(["DHT"]);
      expect(expand(g, "le DA du poste")).toEqual(["Document Applicable", "Disjonction d’Alarme"]);
    });

    it("never adds a one-letter acronym and needs exact case under three letters", () => {
      expect(expand(g, "sectionneur")).toEqual([]);
      expect(expand(g, "S")).toEqual(["Sectionneur"]);
      expect(expand(g, "da")).toEqual([]);
    });
  });

  describe("project glossary", () => {
    let project: string;
    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), "testimus-glossary-"));
      mkdirSync(join(project, "docs", "D"), { recursive: true });
      writeFileSync(join(project, "docs", "D", "doc.md"), MD);
      writeFileSync(
        join(project, "project.json"),
        JSON.stringify({ glossary: { PTS: "Poste de Traction de Secours" } }),
      );
    });
    afterEach(() => rmSync(project, { recursive: true, force: true }));

    it("merges project.json.glossary with the documents' glossaries", () => {
      const g = glossaryOf(project);
      expect(g.find((e) => e.abbr === "PTS")).toEqual({
        abbr: "PTS",
        long: "Poste de Traction de Secours",
        source: "project.json",
      });
      expect(g.find((e) => e.abbr === "DSO")?.source).toBe("D#§1.4");
      expect(expandTerm(project, "PTS")).toEqual(["PTS", "Poste de Traction de Secours"]);
      expect(expandTerm(project, "postes de traction de secours")).toEqual(["postes de traction de secours", "PTS"]);
    });

    it("follows a document's content when it changes", () => {
      expect(expandTerm(project, "TCO")).toEqual(["TCO"]);
      writeFileSync(
        join(project, "docs", "D", "doc.md"),
        `${MD.split("## 1.5")[0]}| TCO | Tableau de Contrôle Optique |\n`,
      );
      expect(expandTerm(project, "TCO")).toEqual(["TCO", "Tableau de Contrôle Optique"]);
    });
  });
});

describe("glossary — less common inputs", () => {
  let dir = "";
  const addDoc = (id: string, md: string, json?: Record<string, unknown>) => {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    if (json) writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify(json));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-search-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("glossary", () => {
    it("rejects cells that are not abbreviations and the header row of a table", () => {
      const md = [
        "## Glossaire <!-- § 2 -->",
        "",
        "| Sigle | Signification |",
        "| --- | --- |",
        "| | vide |",
        "| un sigle beaucoup trop long pour en être un vraiment | long |",
        "| A B C D E | trop de mots |",
        "| -X | ne commence pas par une lettre |",
        "| minuscule | sans majuscule |",
        "| PCC | Poste de commande centralisé |",
      ].join("\n");
      expect(parseGlossary(md, "D").map((g) => g.abbr)).toEqual(["PCC"]);
    });

    it("dedupes entries, re-reads a touched but identical doc.md from its cache, and expands each form once", () => {
      writeFileSync(
        join(dir, "project.json"),
        JSON.stringify({ name: "t", glossary: { PCC: "Poste de commande centralisé" } }),
      );
      const md = "## Acronymes\n\n- PCC : Poste de commande centralisé\n- TK : télécommande\n";
      addDoc("G", md);
      expect(glossaryOf(dir).map((g) => `${g.abbr}=${g.source}`)).toEqual(["PCC=project.json", "TK=G"]);
      const later = new Date(Date.now() + 5000);
      utimesSync(join(dir, "docs", "G", "doc.md"), later, later);
      expect(glossaryOf(dir)).toHaveLength(2);
      const g = [
        { abbr: "TK", long: "télécommande", source: "a" },
        { abbr: "TCK", long: "télécommande", source: "b" },
        { abbr: "", long: "", source: "c" },
      ];
      expect(expand(g, "TK TCK")).toEqual(["télécommande"]);
    });
  });
});
