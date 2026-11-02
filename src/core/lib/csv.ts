export type CsvTable = { separator: "," | ";"; headers: string[]; rows: string[][] };
export type CsvStep = { fields: Record<string, string> };
export type CsvTest = {
  summary: string;
  folder: string;
  description: string;
  labels: string[];
  steps: CsvStep[];
  row: number;
};
export type CsvResult = { tests: CsvTest[]; warnings: string[] };

export const CSV_TARGETS = ["#step", "#summary", "#description", "#folder", "#labels", "#ignore"] as const;

const SOURCE_REF_DROPPED =
  "its numbers point to nothing outside the tool that made them — keep the claims in ### Sources instead";

function sniff(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "\n") break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const separator = sniff(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim()));
  const [head = [], ...rows] = nonEmpty;
  return { separator, headers: head.map((h) => h.trim()), rows };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ALIASES: Record<string, string> = {
  step: "#step",
  "step number": "#step",
  "step no": "#step",
  n: "#step",
  etape: "#step",
  "no etape": "#step",
  summary: "#summary",
  "test summary": "#summary",
  title: "#summary",
  titre: "#summary",
  name: "#summary",
  resume: "#summary",
  description: "#description",
  folder: "#folder",
  dossier: "#folder",
  "test repository path": "#folder",
  labels: "#labels",
  label: "#labels",
  action: "Action",
  data: "Data",
  donnees: "Data",
  "test data": "Data",
  expected: "Expected Result",
  "expected result": "Expected Result",
  "expected results": "Expected Result",
  "resultat attendu": "Expected Result",
  "source reference": "#ignore",
};

export function guessMapping(headers: string[], fieldNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const n = norm(h);
    const field = fieldNames.find((f) => norm(f) === n);
    out[h] = field ?? ALIASES[n] ?? "#ignore";
  }
  return out;
}

const splitLabels = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function csvTests(
  table: CsvTable,
  mapping: Record<string, string>,
  opts: { name: string; folder: string; fieldNames: string[] },
): CsvResult {
  const warnings: string[] = [];
  const col = (target: string) => table.headers.findIndex((h) => mapping[h] === target);
  const stepCol = col("#step");
  const summaryCol = col("#summary");
  const descCol = col("#description");
  const folderCol = col("#folder");
  const labelsCol = col("#labels");
  const fieldCols = table.headers.flatMap((h, i) => {
    const t = mapping[h];
    return t && !t.startsWith("#") ? [{ i, name: t }] : [];
  });

  for (const [i, h] of table.headers.entries()) {
    const t = mapping[h] ?? "#ignore";
    const used = table.rows.some((r) => (r[i] ?? "").trim());
    if (t === "#ignore" && used)
      warnings.push(
        norm(h) === "source reference"
          ? `Column "${h}" dropped: ${SOURCE_REF_DROPPED}.`
          : `Column "${h}" is mapped to nothing — dropped.`,
      );
    else if (!t.startsWith("#") && !opts.fieldNames.includes(t))
      warnings.push(`Column "${h}" goes to "${t}", which is not a step field of this project (run xray.fields).`);
  }
  if (!fieldCols.length) warnings.push("No column is mapped to a step field — nothing to import.");
  if (summaryCol < 0) warnings.push(`No summary column — the tests are named after the file ("${opts.name}").`);

  const tests: CsvTest[] = [];
  let prevStep = 0;
  let current: CsvTest | null = null;
  const cellOf = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  table.rows.forEach((r, k) => {
    const summary = cellOf(r, summaryCol);
    const n = Number.parseInt(cellOf(r, stepCol), 10);
    const startsByStep = stepCol >= 0 && Number.isFinite(n) && (n === 1 || n <= prevStep);
    const startsBySummary = summaryCol >= 0 && !!summary && summary !== current?.summary;
    if (!current || startsByStep || startsBySummary) {
      current = {
        summary,
        folder: cellOf(r, folderCol) || opts.folder,
        description: cellOf(r, descCol),
        labels: splitLabels(cellOf(r, labelsCol)),
        steps: [],
        row: k + 2,
      };
      tests.push(current);
    }
    if (Number.isFinite(n)) prevStep = n;
    const fields: Record<string, string> = {};
    for (const c of fieldCols) {
      const v = (r[c.i] ?? "").trim();
      if (v) fields[c.name] = v;
    }
    if (Object.keys(fields).length) current.steps.push({ fields });
  });

  tests.forEach((t, i) => {
    if (!t.summary) t.summary = tests.length > 1 ? `${opts.name} (${i + 1})` : opts.name;
    t.steps.forEach((s, j) => {
      if (!s.fields.Action) warnings.push(`"${t.summary}" step ${j + 1} has no Action.`);
      if (!s.fields["Expected Result"]) warnings.push(`"${t.summary}" step ${j + 1} has no Expected Result.`);
    });
    if (!t.steps.length) warnings.push(`"${t.summary}" (row ${t.row}) has no step.`);
  });
  return { tests, warnings };
}
