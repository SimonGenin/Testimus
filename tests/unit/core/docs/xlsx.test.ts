import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { knownSheets, TABLE_MARKER } from "../../../../src/core/claude/table.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { scanFolder } from "../../../../src/core/lib/docs-folder.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { writeZip } from "../../../../src/core/lib/zip.ts";
import { convertWorkbook, profileWorkbook, readWorkbook } from "../../../../src/core/rag/convert-xlsx.ts";
import type { DocJson } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

type Cell = string | number | boolean | { s?: number; v: number } | { f: string; v: string } | { inline: string };
type SheetSpec = { name: string; rows: Cell[][]; state?: string; merges?: string[] };

const enc = new TextEncoder();
const col = (i: number) => String.fromCharCode(65 + i);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ponytail: a workbook as Excel writes one — shared strings, styles with a date and a percentage format, a sheet part
// per sheet named by the workbook's relationships
function workbook(sheets: SheetSpec[], date1904 = false): Uint8Array {
  const shared: string[] = [];
  const sheetXml = (s: SheetSpec) => {
    const rows = s.rows.map((r, y) => {
      const cells = r.map((c, x) => {
        const ref = `${col(x)}${y + 1}`;
        if (c === "") return "";
        if (typeof c === "string") {
          shared.push(c);
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        }
        if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
        if (typeof c === "boolean") return `<c r="${ref}" t="b"><v>${c ? 1 : 0}</v></c>`;
        if ("inline" in c) return `<c r="${ref}" t="inlineStr"><is><r><t>${esc(c.inline)}</t></r></is></c>`;
        if ("f" in c) return `<c r="${ref}" t="str"><f>${c.f}</f><v>${esc(c.v)}</v></c>`;
        return `<c r="${ref}" s="${c.s ?? 0}"><v>${c.v}</v></c>`;
      });
      return `<row r="${y + 1}">${cells.join("")}</row>`;
    });
    const merges = s.merges?.length
      ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "";
    return `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${rows.join("")}</sheetData>${merges}</worksheet>`;
  };
  const parts = sheets.map(sheetXml);
  const entries = [
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<workbook><workbookPr${date1904 ? ' date1904="1"' : ""}/><sheets>${sheets
          .map(
            (s, i) =>
              `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`,
          )
          .join("")}</sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
      ),
    },
    {
      name: "xl/styles.xml",
      data: enc.encode(
        '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>',
      ),
    },
    ...parts.map((p, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(p) })),
    {
      name: "xl/sharedStrings.xml",
      data: enc.encode(`<sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`),
    },
  ];
  return writeZip(entries);
}

const ALARMS: SheetSpec = {
  name: "Alarmes",
  rows: [
    ["Code", "Libellé", "Sous-système", "Seuil", "Taux", "Active", "Depuis"],
    ["ALM-1", "Porte ouverte", "Portes", 0.1 + 0.2, { s: 3, v: 0.125 }, true, { s: 1, v: 45728 }],
    ["ALM-2", { inline: "Frein serré" }, "", 3.5, "", false, { s: 2, v: 45728.5 }],
    ["ALM-3", { f: 'CONCAT("Batt","erie")', v: "Batterie" }, "Énergie", 24, "", "", ""],
  ],
  merges: ["C2:C3"],
};

const real = env.spawnClaude;
let P = "";
let prompts: string[] = [];

beforeEach(() => {
  P = fixtureCopy("xlsx");
  prompts = [];
  resetProbe();
});

afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

describe("reading an Excel workbook", () => {
  it("reads shared and inline strings, numbers, dates, percentages, booleans, formulas and merged cells", () => {
    const [s] = readWorkbook(workbook([ALARMS]));
    expect(s.name).toBe("Alarmes");
    expect(s.records[1]).toEqual(["ALM-1", "Porte ouverte", "Portes", "0.3", "12.5%", "TRUE", "2025-03-12"]);
    expect(s.records[2]).toEqual(["ALM-2", "Frein serré", "Portes", "3.5", "", "FALSE", "2025-03-12 12:00"]);
    expect(s.records[3]).toEqual(["ALM-3", "Batterie", "Énergie", "24"]);
  });

  it("counts days from 1904 when the workbook says so", () => {
    const [s] = readWorkbook(
      workbook(
        [
          {
            name: "S",
            rows: [
              ["A", "B"],
              ["x", { s: 1, v: 0 }],
            ],
          },
        ],
        true,
      ),
    );
    expect(s.records[1][1]).toBe("1904-01-01");
  });

  it("leaves aside a hidden sheet and an empty one, and says why", () => {
    const p = profileWorkbook(
      workbook([ALARMS, { name: "Calc", state: "hidden", rows: [["x", "y"]] }, { name: "Vide", rows: [] }]),
    );
    expect(p.sheets.map((s) => s.name)).toEqual(["Alarmes"]);
    expect(p.sheets[0].guess.key).toBe("Code");
    expect(p.leftAside).toEqual([
      { name: "Calc", why: "hidden" },
      { name: "Vide", why: "empty" },
    ]);
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => readWorkbook(enc.encode("Code;Libellé"))).toThrow(/Not an Excel workbook/);
  });
});

describe("converting a workbook", () => {
  const headings = (md: string) => md.split("\n").filter((l) => l.startsWith("#"));

  it("of one sheet is a table alone", () => {
    const c = convertWorkbook(workbook([ALARMS]), { title: "Alarmes", sheets: [{ name: "Alarmes", key: "Code" }] });
    expect(headings(c.md)).toEqual([
      "# Alarmes <!-- § alarmes -->",
      "## Columns <!-- § columns -->",
      "## ALM-1 <!-- § ALM-1 -->",
      "## ALM-2 <!-- § ALM-2 -->",
      "## ALM-3 <!-- § ALM-3 -->",
    ]);
    expect(c.md).toContain("- **Sous-système** : Portes\n");
    expect(c.warnings).toEqual([]);
  });

  it("of several sheets is a section a sheet, its own Columns, its rows anchored by their key", () => {
    const steps: SheetSpec = {
      name: "Procédures",
      rows: [
        ["Réf", "Étape"],
        ["P-1", "Ouvrir"],
      ],
    };
    const c = convertWorkbook(workbook([ALARMS, steps, { name: "Historique", rows: [["v1", "créé"]] }]), {
      title: "Base",
      sheets: [
        { name: "Alarmes", key: "Code", title: "Libellé", about: "Les alarmes" },
        { name: "Historique", skip: true },
        { name: "Absente" },
      ],
    });
    expect(headings(c.md)).toEqual([
      "# Base <!-- § base -->",
      "## Alarmes <!-- § alarmes -->",
      "### Columns <!-- § alarmes-columns -->",
      "### ALM-1 Porte ouverte <!-- § ALM-1 -->",
      "### ALM-2 Frein serré <!-- § ALM-2 -->",
      "### ALM-3 Batterie <!-- § ALM-3 -->",
      "## Procédures <!-- § procedures -->",
      "### Columns <!-- § procedures-columns -->",
      "### P-1 <!-- § P-1 -->",
    ]);
    expect(c.md).toContain("<!-- = Les alarmes -->");
    expect(c.warnings).toEqual([
      "The sheet « Absente » is not in the workbook",
      "Sheet « Procédures »: The columns were not read by Claude: rows are named by « Réf »",
    ]);
  });

  it("keeps of Claude's reading only the sheets and columns the workbook has", () => {
    const p = profileWorkbook(workbook([ALARMS]));
    expect(
      knownSheets(
        [
          { name: "Alarmes", key: "Nope", columns: [{ name: "Code", meaning: "id" }] },
          { name: "Other", skip: true },
        ],
        p,
      ),
    ).toEqual([{ name: "Alarmes", columns: [{ name: "Code", meaning: "id" }] }]);
  });
});

describe("an .xlsx document", () => {
  it("is read by Claude sheet by sheet before its first conversion", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    env.spawnClaude = async (s: ClaudeSpawn): Promise<ClaudeOut> => {
      prompts.push(s.stdin);
      const reply = { sheets: [{ name: "Alarmes", key: "Code", columns: [{ name: "Seuil", meaning: "en bar" }] }] };
      const text = ["```table", JSON.stringify(reply), "```"].join("\n");
      const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 5 });
      s.onLine?.(l);
      return { code: 0, stdout: s.stdin ? `${l}\n` : "2.1.0 (Claude Code)\n", stderr: "" };
    };
    const file = join(mkdtempSync(join(tmpdir(), "testimus-client-")), "Alarmes TCMS.xlsx");
    writeFileSync(file, workbook([ALARMS]));
    const d = await call<DocJson>("docs.add", { file, index: false }, P);
    expect(d.source.file).toBe("source.xlsx");
    const asked = prompts.filter((p) => p.startsWith(TABLE_MARKER));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("an Excel workbook that Read cannot open");
    expect(d.conversion?.sheets).toEqual([
      { name: "Alarmes", key: "Code", columns: [{ name: "Seuil", meaning: "en bar" }] },
    ]);
    const md = readFileSync(join(P, "docs", d.id, "doc.md"), "utf8");
    expect(md).toContain("## ALM-2 <!-- § ALM-2 -->");
    expect(md).toContain("- **Seuil** <!-- = en bar -->");
    expect(d.converted?.warnings).toEqual([]);
  });

  it("is a document in a folder; an old .xls is left aside with what to do", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-folder-"));
    writeFileSync(join(dir, "Base.xlsx"), workbook([ALARMS]));
    writeFileSync(join(dir, "Ancien.xls"), "x");
    const scan = scanFolder(null, dir, false);
    expect(scan.files.find((f) => f.rel === "Base.xlsx")).toMatchObject({ importable: true });
    expect(scan.files.find((f) => f.rel === "Ancien.xls")).toMatchObject({
      importable: false,
      why: "an old Excel .xls: save it as .xlsx in Excel first",
    });
  });
});
