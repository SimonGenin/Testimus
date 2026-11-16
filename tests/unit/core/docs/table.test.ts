import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { knownTable, TABLE_MARKER } from "../../../../src/core/claude/table.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { loadCorpus, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { scanFolder } from "../../../../src/core/lib/docs-folder.ts";
import { pairFiles } from "../../../../src/core/lib/docs-pipeline.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { parseSections, shownText } from "../../../../src/core/rag/chunk.ts";
import { convertTable, profileTable, readTable } from "../../../../src/core/rag/convert-table.ts";
import type { DocJson, Test } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let P = "";
let prompts: string[] = [];
const bytes = (s: string) => new TextEncoder().encode(s);
const client = (name: string, data: string | Uint8Array) => {
  const f = join(mkdtempSync(join(tmpdir(), "testimus-client-")), name);
  writeFileSync(f, data);
  return f;
};
const md = (id: string) => readFileSync(join(P, "docs", id, "doc.md"), "utf8");
const headings = (text: string) => text.split("\n").filter((l) => l.startsWith("#"));

const ALARMS = [
  "Export Alarmes;;;",
  "Code;Libellé;Criticité;Action opérateur;Base",
  'ALM-001;Porte ouverte;2;"Fermer la porte,',
  'puis acquitter l\'""alarme""";',
  "ALM-002;Frein de parking serré;3;Desserrer le frein;",
  "ALM-003;Tension batterie basse;1;;",
  "",
].join("\r\n");

// ponytail: the faked Claude answers the version probe and the table reading, like the real one
function claude(reply: unknown) {
  env.spawnClaude = async (s: ClaudeSpawn): Promise<ClaudeOut> => {
    prompts.push(s.stdin);
    const text = ["```table", JSON.stringify(reply), "```"].join("\n");
    const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 5 });
    s.onLine?.(l);
    return { code: 0, stdout: s.stdin ? `${l}\n` : "2.1.0 (Claude Code)\n", stderr: "" };
  };
}

beforeEach(() => {
  P = fixtureCopy("table");
  prompts = [];
  resetProbe();
});

afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

describe("reading a table", () => {
  it("finds the delimiter, the header under a preamble, quoted cells with line breaks and quotes", () => {
    const t = readTable(bytes(ALARMS));
    expect(t.delimiter).toBe(";");
    expect(t.headerRow).toBe(2);
    expect(t.preamble).toEqual([["Export Alarmes", "", "", ""]]);
    expect(t.header).toEqual(["Code", "Libellé", "Criticité", "Action opérateur", "Base"]);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0][3]).toBe('Fermer la porte,\npuis acquitter l\'"alarme"');
  });

  it("takes Excel's sep= line, names a column without a name and tells two of the same name apart", () => {
    const t = readTable(bytes('sep=,\nA,,A\n1,2,3\n"x, y",5,6\n'));
    expect(t.delimiter).toBe(",");
    expect(t.header).toEqual(["A", "Column 2", "A (2)"]);
    expect(t.rows[1]).toEqual(["x, y", "5", "6"]);
  });

  it("reads Windows-1252 and a tab-separated file", () => {
    const t = readTable(Uint8Array.from([0x43, 0xe9, 0x09, 0x42, 0x0a, 0x31, 0x09, 0x32]), { tsv: true });
    expect(t.header).toEqual(["Cé", "B"]);
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it("profiles each column and guesses the key: filled on every row, each value its own", () => {
    const p = profileTable(readTable(bytes(ALARMS)));
    const code = p.columns.find((c) => c.name === "Code");
    expect(code).toMatchObject({ filled: 3, distinct: 3, unique: true });
    expect(p.columns.find((c) => c.name === "Base")?.filled).toBe(0);
    expect(p.guess).toEqual({ key: "Code", columns: [{ name: "Base", skip: true }] });
    expect(p.preamble).toEqual(["Export Alarmes"]);
  });
});

describe("converting a table", () => {
  const read = {
    key: "Code",
    title: "Libellé",
    about: "Les alarmes du train.",
    columns: [
      { name: "Criticité", meaning: "1 = mineure, 3 = critique" },
      { name: "Base", skip: true },
    ],
  };

  it("makes a section a row, anchored by its key, the columns and Claude's reading at the head", () => {
    const c = convertTable(bytes(ALARMS), { title: "Alarmes", table: read });
    expect(headings(c.md)).toEqual([
      "# Alarmes <!-- § alarmes -->",
      "## Columns <!-- § columns -->",
      "## ALM-001 Porte ouverte <!-- § ALM-001 -->",
      "## ALM-002 Frein de parking serré <!-- § ALM-002 -->",
      "## ALM-003 Tension batterie basse <!-- § ALM-003 -->",
    ]);
    expect(c.md).toContain("<!-- = Les alarmes du train. -->");
    expect(c.md).toContain("- **Criticité** <!-- = 1 = mineure, 3 = critique -->");
    expect(c.md).not.toContain("**Base**");
    expect(c.md).toContain('- **Action opérateur** : Fermer la porte,\n  puis acquitter l\'"alarme"');
    expect(c.warnings).toEqual([]);
    expect(c.convertedWith).toBe("table 1");
    expect(parseSections(c.md).find((s) => s.anchor === "§ALM-002")?.title).toBe("Frein de parking serré");
  });

  it("shows what Claude read under the line, never in what a quote is checked against", () => {
    const c = convertTable(bytes(ALARMS), { title: "Alarmes", table: read });
    const columns = parseSections(c.md).find((s) => s.anchor === "§columns");
    expect(shownText(columns?.body ?? "")).toContain("- **Criticité**\n  = 1 = mineure, 3 = critique");
  });

  it("groups the rows by a column, and names the rows of a table without key by their title, else by what they hold", () => {
    const csv = "Système,Nom,Valeur\nFrein,Pression,5\nPorte,Ouverture,1\nFrein,Pression,6\n,,7\n";
    const c = convertTable(bytes(csv), { title: "Signaux", table: { group: "Système", title: "Nom" } });
    expect(
      headings(c.md).map((h) => h.replace(/row-[0-9a-f]{8}/, "row-x").replace(/Row [0-9a-f]{8}/, "Row x")),
    ).toEqual([
      "# Signaux <!-- § signaux -->",
      "## Columns <!-- § columns -->",
      "## Frein <!-- § frein -->",
      "### Pression <!-- § pression -->",
      "### Pression <!-- § pression-2 -->",
      "## Porte <!-- § porte -->",
      "### Ouverture <!-- § ouverture -->",
      "## (Système empty) <!-- § systeme-empty -->",
      "### Row x <!-- § row-x -->",
    ]);
  });

  it("without Claude's reading, says so and names the rows by the guessed key; a key told twice is anchored -2", () => {
    const c = convertTable(bytes("Id;Texte\nR1;a\nR1;a\n"), { title: "Exigences" });
    expect(c.warnings[0]).toMatch(/not read by Claude: no column names the rows/);
    const keyed = convertTable(bytes("Id;Texte\nR1;a\nR1;b\n"), { title: "Exigences", table: { key: "Id" } });
    expect(headings(keyed.md).slice(2)).toEqual(["## R1 <!-- § R1 -->", "## R1 <!-- § R1-2 -->"]);
    expect(keyed.warnings).toEqual(["1 rows share their key with a row above: anchored with -2, -3…"]);
  });

  it("warns about a column Claude named that the table does not have", () => {
    const c = convertTable(bytes(ALARMS), {
      title: "A",
      table: { key: "Ref", columns: [{ name: "Nope", meaning: "x" }] },
    });
    expect(c.warnings).toEqual([
      "The key column « Ref » is not in the table: left aside",
      "The column « Nope » is not in the table",
    ]);
  });

  it("keeps of Claude's reading only the columns the table has", () => {
    const p = profileTable(readTable(bytes(ALARMS)));
    expect(
      knownTable({ key: "Code", title: "Label", columns: [{ name: "Code" }, { name: "Label", meaning: "?" }] }, p),
    ).toEqual({ key: "Code", columns: [{ name: "Code" }] });
  });
});

describe("a .csv document", () => {
  it("is read by Claude before its first conversion, kept, and cited by its rows", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    claude({
      key: "Code",
      title: "Libellé",
      about: "Les alarmes",
      columns: [{ name: "Criticité", meaning: "1 à 3" }, { name: "Inconnue" }],
    });
    const d = await call<DocJson>("docs.add", { file: client("Alarmes.csv", ALARMS), index: false }, P);
    expect(d.source.file).toBe("source.csv");
    const asked = prompts.filter((p) => p.startsWith(TABLE_MARKER));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`docs/${d.id}/source.csv`);
    expect(asked[0]).toContain('"name": "Criticité"');
    expect(d.conversion?.table).toEqual({
      key: "Code",
      title: "Libellé",
      about: "Les alarmes",
      columns: [{ name: "Criticité", meaning: "1 à 3" }],
    });
    expect(md(d.id)).toContain("## ALM-002 Frein de parking serré <!-- § ALM-002 -->");
    expect(d.converted?.warnings).toEqual([]);

    await call("docs.convert", { id: d.id, index: false }, P);
    expect(prompts.filter((p) => p.startsWith(TABLE_MARKER))).toHaveLength(1);
    await call("docs.convert", { id: d.id, index: false, study: true }, P);
    expect(prompts.filter((p) => p.startsWith(TABLE_MARKER))).toHaveLength(2);

    const test = {
      summary: "s",
      description: "d",
      steps: [
        {
          fields: { Action: "a", "Expected Result": "b" },
          sources: [{ docId: d.id, anchor: "§ALM-001", quote: 'Fermer la porte, puis acquitter l\'"alarme"' }],
          images: [],
        },
      ],
    } as unknown as Test;
    expect(mechanicalFindings(test, loadCorpus(P)).filter((f) => f.severity === "error")).toEqual([]);
    const meaning = {
      ...test,
      steps: [{ ...test.steps[0], sources: [{ ...test.steps[0].sources[0], quote: "1 à 3" }] }],
    };
    expect(mechanicalFindings(meaning as Test, loadCorpus(P)).map((f) => f.kind)).toContain("quote-not-found");
  });

  it("without Claude is converted from Testimus' own guess, with a warning", async () => {
    const d = await call<DocJson>("docs.add", { file: client("Alarmes.csv", ALARMS), index: false }, P);
    expect(d.conversion?.table).toBeUndefined();
    expect(md(d.id)).toContain("## ALM-001 <!-- § ALM-001 -->");
    expect(md(d.id)).toContain("- **Libellé** : Porte ouverte");
    expect(d.converted?.warnings[0]).toMatch(/not read by Claude: rows are named by « Code »/);
  });

  it("is a document among files picked and in a folder", () => {
    expect(pairFiles([{ path: "a.csv" }, { path: "b.tsv" }, { path: "c.ods" }]).docs.map((x) => x.main.path)).toEqual([
      "a.csv",
      "b.tsv",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "testimus-folder-"));
    writeFileSync(join(dir, "Signaux.csv"), "a;b\n1;2\n");
    const scan = scanFolder(null, dir, false);
    expect(scan.files.find((f) => f.rel === "Signaux.csv")).toMatchObject({ importable: true, id: "Signaux" });
  });
});
