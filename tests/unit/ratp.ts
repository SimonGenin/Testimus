import { scopeOf as scopeWith } from "../../src/core/lib/check.ts";
import { LEGACY_PATTERN } from "../../src/core/lib/traces.ts";
import { chunkDoc as chunkWith } from "../../src/core/rag/chunk.ts";
import type { ConvertOpts } from "../../src/core/rag/convert.ts";
import { convertDocx as docxWith } from "../../src/core/rag/convert-docx.ts";
import { convertPdf as pdfWith } from "../../src/core/rag/convert-pdf.ts";
import {
  matrixColumns as columnsWith,
  type EvidenceOpts,
  type MdTable,
  matricesOf as matricesWith,
  matrixRows as rowsWith,
  statementsOf as statementsWith,
} from "../../src/core/rag/statements.ts";
import type { DocJson, FigureEntry } from "../../src/core/types.ts";

// ponytail: the fixtures are RATP documents: these are the pure helpers with RATP's requirement ids declared, as a
// RATP project does in project.json.traces
export const RATP: EvidenceOpts = { patterns: [LEGACY_PATTERN] };
const ratp = (o: EvidenceOpts = {}): EvidenceOpts => ({ ...RATP, ...o });

export const statementsOf = (id: string, md: string, o?: EvidenceOpts) => statementsWith(id, md, ratp(o));
export const matrixRows = (md: string, o?: EvidenceOpts) => rowsWith(md, ratp(o));
export const matricesOf = (md: string, o?: EvidenceOpts) => matricesWith(md, ratp(o));
export const matrixColumns = (t: MdTable, o?: EvidenceOpts) => columnsWith(t, ratp(o));
export const scopeOf = (md: string, anchor: string, o?: EvidenceOpts) => scopeWith(md, anchor, ratp(o));
export const chunkDoc = (doc: DocJson, md: string, entries: FigureEntry[], o?: EvidenceOpts) =>
  chunkWith(doc, md, entries, ratp(o));
export const convertDocx = (buf: Uint8Array, o: ConvertOpts) =>
  docxWith(buf, { ...o, reqPatterns: [LEGACY_PATTERN, ...(o.reqPatterns ?? [])] });
export const convertPdf = (buf: Uint8Array, o: ConvertOpts) =>
  pdfWith(buf, { ...o, reqPatterns: [LEGACY_PATTERN, ...(o.reqPatterns ?? [])] });
