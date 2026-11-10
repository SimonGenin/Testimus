import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { refuseLeftOut } from "../claude/access.ts";
import { attachedContexts } from "../claude/given.ts";
import { command, projectOf, UserError } from "../command.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { contextMtime, docDir, docShape, headingAt, partOf, readContext, readDoc, readDocMd } from "../lib/docs.ts";
import { docsFreshness } from "../lib/docs-index.ts";
import { isObserved, sourceType } from "../lib/media.ts";
import { renderPage } from "../rag/pdf.ts";
import type { DocJson } from "../types.ts";
import { docJson, figure, id, mtime, status } from "./docs-schemas.ts";
import { SOURCE_TYPE } from "./media-schemas.ts";

// ponytail: an answer of docs.show holds about 15 000 tokens, what an answer to Claude can hold
const DOC_PAGE = 60_000;

const linesIn = (text: string, to: number) => {
  let n = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < to; i = text.indexOf("\n", i + 1)) n++;
  return n;
};

// ponytail: a page of a text (doc.md, or a part of it) from `from`, cut at a line: the outline and the figures the
// answer carries count in its budget, the text gets the rest — never less than a fifth of it. A later page carries
// only the sections and figures inside it (the first gave them all); first is the text's first line in doc.md
function pageOf<T extends { line?: number }, F extends { line?: number }>(
  text: string,
  first: number,
  from: number | undefined,
  toc: T[],
  figures: F[],
) {
  const start = Math.min(from ?? 0, text.length);
  const end = (room: number) => {
    const cut = text.length - start <= room ? text.length : text.lastIndexOf("\n", start + room) + 1;
    return cut > start ? cut : Math.min(text.length, start + room);
  };
  const carried = (to: number) => {
    if (start === 0) return { toc, figures };
    const top = first + linesIn(text, start);
    const bottom = first + linesIn(text, Math.max(start, to - 1));
    const inside = (x: { line?: number }) => x.line !== undefined && x.line >= top && x.line <= bottom;
    return { toc: toc.filter(inside), figures: figures.filter(inside) };
  };
  const most = carried(end(DOC_PAGE));
  const to = end(Math.max(DOC_PAGE / 5, DOC_PAGE - JSON.stringify([most.toc, most.figures]).length));
  return { ...carried(to), md: text.slice(start, to), ...(to < text.length ? { next: to } : {}) };
}

// ponytail: what a document is, worked out here once — the page reads it, never the rules behind it
const what = {
  type: SOURCE_TYPE.describe(
    "What the document is made of (doc.json source.type, else read from its copy's extension): docx, pdf, txt, images, video or mixed",
  ),
  observed: z
    .boolean()
    .describe(
      "An images or video document the team has not marked as the reference: it shows how the real system behaves, never what it must do",
    ),
};
const whatOf = (d: DocJson) => ({ type: sourceType(d), observed: isObserved(d) });

export const commands = [
  command({
    name: "docs.page",
    summary:
      "Draw one page of a document's PDF copy (the original, or the rendering beside its .docx), or a region of it, as a PNG to look at; returns its path.",
    input: z.object({
      id,
      page: z.coerce.number().int().min(1).describe("Page number, from 1"),
      region: z
        .array(z.number().min(0).max(1))
        .length(4)
        .optional()
        .describe("Part of the page as [left, top, right, bottom], fractions of the page from its top left corner"),
    }),
    output: z.object({
      file: z.string().describe("Absolute path of the PNG (under .testimus/pages/), to Read"),
      page: z.number().describe("The page drawn"),
      pages: z.number().describe("Pages in the PDF"),
      width: z.number().describe("Width in pixels"),
      height: z.number().describe("Height in pixels"),
    }),
    // ponytail: .testimus/pages/ is a cache, like the index — drawing a page changes nothing the project says, and a
    // study run (read-only tools) must be able to look at the pages
    mutates: false,
    positional: ["id", "page"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      readDoc(project, input.id);
      const pdf = join(docDir(project, input.id), "source.pdf");
      if (!existsSync(pdf))
        throw new UserError(
          `${input.id} has no PDF copy to draw.`,
          `Give its PDF rendering: testimus docs convert ${input.id} --pdf <file.pdf>`,
        );
      const r = input.region;
      if (r && (r[2] - r[0] < 0.02 || r[3] - r[1] < 0.02))
        throw new UserError(
          "The region is empty.",
          "Give [left, top, right, bottom] with left < right and top < bottom.",
        );
      let out: Awaited<ReturnType<typeof renderPage>>;
      try {
        out = await renderPage(readFileSync(pdf), input.page, r as [number, number, number, number] | undefined);
      } catch (e) {
        if (e instanceof RangeError) throw new UserError(e.message, "Give a page number the PDF has.");
        throw e;
      }
      const name = r ? `p${input.page}-${r.map((v) => Math.round(v * 100)).join("-")}.png` : `p${input.page}.png`;
      const file = join(project, ".testimus", "pages", input.id, name);
      mkdirSync(join(file, ".."), { recursive: true });
      writeAtomic(file, out.png);
      return { file, page: input.page, pages: out.pages, width: out.width, height: out.height };
    },
  }),
  command({
    name: "docs.list",
    summary: "List the project's documents with their status and index freshness.",
    input: z.object({ status: status.optional().describe("Only the documents with this status") }),
    output: z.array(
      docJson.extend({
        ...what,
        indexed: z
          .enum(["fresh", "stale", "missing"])
          .describe(
            "Index state: missing until an index run read it; stale when its text changed since, or the active model's vectors are incomplete; fresh otherwise (the rule of rag.status)",
          ),
        indexing: z
          .object({
            state: z
              .enum(["running", "waiting"])
              .describe("running: the index run under way is reading it; waiting: it will, once its turn comes"),
            percent: z.number().describe("How far the run got with this document, 0 to 100"),
            done: z.number().describe("Passages of this document embedded by the run so far"),
            total: z.number().describe("Passages of this document the run embeds (0 until it starts embedding)"),
          })
          .optional()
          .describe(
            "Set while an index run is under way or waiting and this document is not fresh: the run reads it, so its stale or missing state is the run's own work in progress, not a problem",
          ),
      }),
    ),
    mutates: false,
    async run(ctx, input) {
      const all = (await docsFreshness(projectOf(ctx))).map((d) => ({ ...d, ...whatOf(d) }));
      return input.status ? all.filter((d) => d.status === input.status) : all;
    },
  }),
  command({
    name: "docs.show",
    summary: "Show a document: metadata, context, table of contents, figures and its text.",
    input: z.object({
      id,
      anchor: z
        .string()
        .optional()
        .describe("Return only this part of doc.md: §5.6.6 (a section and its subsections), fig:40, page:59"),
      brief: z
        .boolean()
        .optional()
        .describe(
          "Leave the text out (md empty): the facts, outline and figures only — what a conversion has written so far",
        ),
      from: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Where the page of text starts, in characters of doc.md — or of the part, with an anchor (the next of the previous answer); 0 by default",
        ),
      whole: z
        .boolean()
        .optional()
        .describe(
          "With an anchor: the whole part in one answer however long (the page's reader); without it a long part comes a page at a time",
        ),
    }),
    output: z.object({
      doc: docJson,
      ...what,
      context: z.string().describe("What the team says about this document (context.md)"),
      contextMtime: mtime,
      contexts: z
        .array(z.string())
        .describe("Saved contexts Claude reads with this document: its own list, else the project's defaults"),
      toc: z
        .array(
          z.object({
            anchor: z.string().describe("Section anchor, §N"),
            title: z.string().describe("Heading title, without its number"),
            level: z.number().describe("Depth, 1 for a chapter"),
            line: z.number().describe("Line of doc.md the heading is on, from 1"),
          }),
        )
        .describe(
          "The sections of doc.md, in order; with an anchor, those inside the part only; on a later page (from), those inside the page",
        ),
      figures: z
        .array(figure.extend({ line: z.number().optional().describe("Line of doc.md the figure is on, from 1") }))
        .describe(
          "The figures of the text in reading order: figures.json, and the captions with no picture (a table, or a lost picture); with an anchor, those inside the part only; on a later page (from), those inside the page",
        ),
      lines: z.number().describe("Lines in doc.md"),
      chars: z.number().describe("Characters in doc.md"),
      md: z
        .string()
        .describe(
          `A page of doc.md, or of the part asked, from \`from\`, cut at a line — the answer holds about ${DOC_PAGE} characters with its toc and figures; empty with brief`,
        ),
      next: z
        .number()
        .optional()
        .describe("When doc.md (or the part) goes on past this page: the from of the next page"),
      section: z
        .string()
        .optional()
        .describe("With an anchor: the section (§…) whose heading holds it, the toc entry to show as current"),
    }),
    mutates: false,
    positional: ["id", "anchor"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      refuseLeftOut(ctx.llm, input.id, project);
      const doc = readDoc(project, input.id);
      const shape = docShape(project, input.id);
      const told = {
        doc,
        ...whatOf(doc),
        context: readContext(project, input.id),
        contextMtime: contextMtime(project, input.id),
        contexts: attachedContexts(project, { kind: "doc", docId: input.id }).map((a) => a.id),
        lines: shape.lines,
        chars: shape.chars,
      };
      const figures = shape.figures.map(({ n: _, ...f }) => f);
      if (input.brief && !input.anchor) return { ...told, toc: shape.toc, figures, md: "" };
      const full = readDocMd(project, input.id);
      if (!input.anchor) return { ...told, ...pageOf(full, 1, input.from, shape.toc, figures) };
      const part = partOf(full, input.anchor);
      if (part === null)
        throw new UserError(
          `No anchor ${input.anchor} in ${input.id}.`,
          `testimus docs show ${input.id} lists its toc.`,
        );
      const inside = (line?: number) => line !== undefined && line >= part.first && line <= part.last;
      const section = headingAt(full, input.anchor);
      const toc = shape.toc.filter((t) => inside(t.line));
      const own = figures.filter((f) => inside(f.line));
      const page =
        input.brief || input.whole
          ? { toc, figures: own, md: input.brief ? "" : part.text }
          : pageOf(part.text, part.first, input.from, toc, own);
      return { ...told, ...page, ...(section ? { section } : {}) };
    },
  }),
];
