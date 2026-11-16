import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Ctx } from "../command.ts";
import { docDir } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { profileTable, readTable, type TableProfile } from "../rag/convert-table.ts";
import { profileWorkbook, WORKBOOK_FILE, type WorkbookProfile } from "../rag/convert-xlsx.ts";
import { DOC_SHEETS, DOC_TABLE } from "../schemas.ts";
import type { DocConversion, DocJson, DocSheet, DocTable } from "../types.ts";
import { docGiven, GIVEN_SLOT } from "./given.ts";
import { languageName } from "./language.ts";
import { readBlock } from "./parts.ts";
import type { JobRun, PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const TABLE_MARKER = "Testimus table reading";
export const TABLE_TAG = "table";

const COLUMNS = [{ name: "…", meaning: "…" }];

export function tablePrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  file: string,
  profile: string,
  language: string,
  extra: string[] = [],
  workbook = false,
): string {
  return [
    `${TABLE_MARKER} of the document ${doc.id} (${doc.title || doc.code}) before its conversion.`,
    "Use the study-document skill, part « A table »: say what the table is and what each column holds, and choose how its rows become sections. Edit no file.",
    ...extra,
    "",
    workbook
      ? `The original is ${file}, an Excel workbook that Read cannot open: what Testimus read of each sheet is below (each column's fill, distinct values and a few of them; guess = what Testimus would do alone; leftAside = sheets not read).`
      : `The original is ${file}. What Testimus read of it (each column's fill, distinct values and a few of them; guess = what Testimus would do alone):`,
    "```json",
    profile,
    "```",
    "",
    `Reply with only this block — ${workbook ? "sheet and column names" : "column names"} exactly as in the profile, about and meanings in ${languageName(language)}:`,
    "```" + TABLE_TAG,
    JSON.stringify(
      workbook
        ? {
            sheets: [
              { name: "…", key: "…", title: "…", about: "…", columns: COLUMNS },
              { name: "…", skip: true },
            ],
          }
        : { key: "…", title: "…", about: "…", columns: COLUMNS },
    ),
    "```",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "table",
    name: "Read the columns of a table",
    group: "Documents",
    kind: "study",
    usedBy: ["Documents: import and conversion of a .csv, .tsv or Excel workbook", "docs.convert"],
    answers:
      "What the table (each sheet of a workbook) is, what each column holds and how its rows become sections, in the block that ends the reply",
    text: () =>
      tablePrompt({ id: "{docId}", code: "", title: "{title}" }, "{file}", "{profile}", "{language}", GIVEN_SLOT),
  },
];

// ponytail: Claude's reading keeps only the columns the table has — a name it misspelt is dropped, never guessed
export function knownTable<T extends DocTable>(v: T, profile: Pick<TableProfile, "columns">): DocTable {
  const names = new Set(profile.columns.map((c) => c.name));
  const known = (n?: string) => (n && names.has(n) ? n : undefined);
  const columns = (v.columns ?? []).filter((c) => names.has(c.name));
  const out: DocTable = {};
  if (v.delimiter) out.delimiter = v.delimiter;
  if (v.headerRow) out.headerRow = v.headerRow;
  for (const k of ["key", "title", "group"] as const) {
    const n = known(v[k]);
    if (n) out[k] = n;
  }
  if (v.about?.trim()) out.about = v.about.trim();
  if (columns.length) out.columns = columns;
  return out;
}

// ponytail: and only the sheets the workbook has
export function knownSheets(v: DocSheet[], profile: WorkbookProfile): DocSheet[] {
  return v.flatMap((s) => {
    const p = profile.sheets.find((x) => x.name === s.name);
    if (!p) return [];
    return [{ name: s.name, ...(s.skip ? { skip: true } : knownTable(s, p)) }];
  });
}

export type TableResult = {
  ok: boolean;
  summary: string;
  conversion: Pick<DocConversion, "table" | "sheets"> | null;
  errors: string[];
};

export async function readTableColumns(ctx: Ctx, project: string, doc: DocJson, claude: JobRun): Promise<TableResult> {
  ctx.progress({ message: `Claude reads the columns of ${doc.id}` });
  const file = doc.source.file || "";
  const ext = extname(file).toLowerCase();
  const workbook = WORKBOOK_FILE.test(ext);
  const bytes = await readFile(join(docDir(project, doc.id), file), { signal: ctx.signal });
  const now = doc.conversion?.table;
  const profile = workbook
    ? profileWorkbook(bytes)
    : profileTable(readTable(bytes, { delimiter: now?.delimiter, headerRow: now?.headerRow, tsv: ext === ".tsv" }));
  const p = readProject(project);
  const g = docGiven(project, "study", doc.id, claude);
  const shown = JSON.stringify(profile, null, 1);
  const prompt = tablePrompt(doc, `docs/${doc.id}/${file}`, shown, p.language, g.lines, workbook);
  const r = await runClaude({
    kind: "study",
    project,
    prompt,
    given: g,
    model: claude.model || p.claude.model,
    effort: claude.effort || "low",
    label: "import",
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  if (!r.ok) return { ok: false, summary: r.summary, conversion: null, errors: [] };
  if (workbook) {
    const b = readBlock(r.summary, TABLE_TAG, DOC_SHEETS);
    const sheets = b.value ? knownSheets(b.value.sheets, profile as WorkbookProfile) : [];
    return { ok: true, summary: r.summary, conversion: sheets.length ? { sheets } : null, errors: b.errors };
  }
  const b = readBlock(r.summary, TABLE_TAG, DOC_TABLE);
  const table = b.value ? knownTable(b.value, profile as TableProfile) : null;
  return { ok: true, summary: r.summary, conversion: table ? { table } : null, errors: b.errors };
}
