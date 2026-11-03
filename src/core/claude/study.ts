import type { Ctx } from "../command.ts";
import { readProject } from "../lib/project.ts";
import type { DocConversion, DocJson } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { docContexts, docRunLines, type JobRun } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";

export const STUDY_MARKER = "Testimus study";
export const CONVERSION_CHECK_MARKER = "Testimus conversion check";
export const CONVERSION_TAG = "conversion";

const NUMBER = /^(?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8}$/;

// ponytail: Claude's choice is data — anything outside the converter's own options is left out
export function conversionOf(v: unknown): DocConversion | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: DocConversion = {};
  if (o.from === "docx" || o.from === "pdf") out.from = o.from;
  if (o.reader === "tagged" || o.reader === "layout") out.reader = o.reader;
  if (Array.isArray(o.numbers)) {
    const numbers = o.numbers.flatMap((e) => {
      const x = e as { number?: unknown; title?: unknown };
      const number = typeof x?.number === "string" ? x.number.trim().replace(/\.$/, "") : "";
      const title = typeof x?.title === "string" ? x.title.replace(/\s+/g, " ").trim() : "";
      return NUMBER.test(number) && title ? [{ number, title }] : [];
    });
    if (numbers.length) out.numbers = numbers;
  }
  if (typeof o.notes === "string" && o.notes.trim()) out.notes = o.notes.trim().slice(0, 2000);
  return out;
}

export function parseConversion(text: string): DocConversion | null {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  for (const [, tag, body] of [...blocks.filter((b) => b[1] === CONVERSION_TAG), ...blocks]) {
    try {
      const c = conversionOf(JSON.parse(body));
      if (c && (tag === CONVERSION_TAG || Object.keys(c).length)) return c;
    } catch {}
  }
  return null;
}

export const sameConversion = (a: DocConversion = {}, b: DocConversion = {}) =>
  a.from === b.from && a.reader === b.reader && JSON.stringify(a.numbers ?? []) === JSON.stringify(b.numbers ?? []);

const block = (example: DocConversion) => ["```" + CONVERSION_TAG, JSON.stringify(example), "```"];

export function studyPrompt(
  doc: Pick<DocJson, "id" | "code" | "title" | "conversion">,
  inspection: unknown,
  extra: string[] = [],
): string {
  return [
    `${STUDY_MARKER} of the document ${doc.id} (${doc.title || doc.code}) before its conversion.`,
    "Use the study-document skill, part « Before the conversion ».",
    "Testimus inspected its original (docs_inspect, below). Then look at the pages yourself — at least three, before",
    "you answer: docs_page { id, page } draws one as a PNG, Read it. The cover, a table of contents page, two body",
    "pages with headings, a page with a figure or a table, and a page without text if there is one.",
    "",
    "Then choose how it is converted (leave out what Testimus already does well):",
    '- from: "docx" or "pdf" — only when both copies are in the folder;',
    '- reader: "tagged" or "layout" — the PDF reader, only to override what Testimus chose;',
    "- numbers: [{ number, title }] — only when heading numbers are printed on the pages but missing from the PDF",
    "  text and neither bookmarks nor table of contents give them: every such heading, in reading order, number and",
    "  title as printed;",
    `- notes: one to three sentences in English for the check after the conversion: the caption and numbering`,
    "  conventions you saw, the pages or parts to look at.",
    "Do not edit any file.",
    ...extra,
    "",
    "Inspection:",
    "```json",
    JSON.stringify(inspection),
    "```",
    ...(doc.conversion ? ["", `Current options: ${JSON.stringify(doc.conversion)}`] : []),
    "",
    "Reply with only this block (titles as printed, notes in English):",
    ...block({ reader: "tagged", notes: "…" }),
    "",
  ].join("\n");
}

export function checkPrompt(doc: DocJson, runId: string, extra: string[] = []): string {
  return [
    `${CONVERSION_CHECK_MARKER} of the document ${doc.id} (${doc.title || doc.code}): compare docs/${doc.id}/doc.md`,
    "with its original.",
    "Use the study-document skill, part « After the conversion ».",
    `Converted with ${doc.convertedWith}${doc.stats ? `: ${doc.stats.sections} sections, ${doc.stats.figures} figures` : ""}.`,
    `Options: ${JSON.stringify(doc.conversion ?? {})}`,
    ...(doc.warnings.length ? ["Conversion warnings:", ...doc.warnings.map((w) => `- [doc:${doc.id}] ${w}`)] : []),
    "",
    "docs_page { id, page } draws a page of the original as a PNG (Read it); docs_show { id, anchor } gives a part",
    "of doc.md (page:N, §n, fig:n); docs_inspect gives the counts of the original. Do not edit any file.",
    "Compare against the pages, not against the counts alone: draw and Read at least three pages — a table of contents",
    "page, a page with a table, a page with a figure — and anything doc.md makes you doubt, before you answer.",
    "",
    "If other options would convert it better (another copy, the other reader, heading numbers read on the pages),",
    "reply with a block holding all the options — it replaces the current ones and Testimus converts once more:",
    ...block({ reader: "tagged", numbers: [{ number: "5.2.1", title: "…" }], notes: "…" }),
    ...proposeLines(
      runId,
      "attach the .docx that sits beside the original, recover a figure the conversion lost, read a scanned page",
    ),
    ...extra,
    "",
    "End with one line: what you compared and what differs.",
    "",
  ].join("\n");
}

export type StudyResult = { ok: boolean; summary: string; runId: string; conversion: DocConversion | null };

async function run(
  ctx: Ctx,
  project: string,
  docId: string,
  prompt: string,
  claude: JobRun,
  runId: string,
): Promise<StudyResult> {
  const p = readProject(project);
  const r = await runClaude({
    kind: "study",
    project,
    prompt,
    contexts: docContexts(project, docId, claude),
    model: claude.model || p.claude.model,
    effort: claude.effort || "low",
    runId,
    label: "import",
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  return { ok: r.ok, summary: r.summary, runId: r.runId, conversion: r.ok ? parseConversion(r.summary) : null };
}

export function studyDoc(
  ctx: Ctx,
  project: string,
  doc: DocJson,
  inspection: unknown,
  claude: JobRun,
): Promise<StudyResult> {
  ctx.progress({ message: `Claude studies ${doc.id} before converting it` });
  const prompt = studyPrompt(doc, inspection, docRunLines(project, doc.id, claude));
  return run(ctx, project, doc.id, prompt, claude, newRunId());
}

export function checkConversion(ctx: Ctx, project: string, doc: DocJson, claude: JobRun): Promise<StudyResult> {
  ctx.progress({ message: `Claude compares ${doc.id} with its original` });
  const runId = newRunId();
  return run(ctx, project, doc.id, checkPrompt(doc, runId, docRunLines(project, doc.id, claude)), claude, runId);
}
