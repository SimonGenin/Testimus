import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../../command.ts";
import { readJson } from "../../lib/project.ts";
import type { DocJson, FigureEntry, Passage, PassageOutlineItem, ProjectJson } from "../../types.ts";
import { docFigures, lines, markerLine, parseSections, type Section, sectionAt, stripComments } from "../chunk.ts";
import { evidenceOptions, matrixRows, statementsOf, tablesOf } from "../statements.ts";

export type FigureView = FigureEntry & { docId: string; n: string; path: string; absPath: string; exists: boolean };
export type PassageView = Passage;

export const PASSAGE_MAX_CHARS = 12_000;

function readDoc(project: string, docId: string): { doc: DocJson; md: string; figures: FigureEntry[]; dir: string } {
  const dir = join(project, "docs", docId);
  if (!existsSync(join(dir, "doc.md")))
    throw new UserError(`No document ${docId} in this project.`, "testimus docs list shows the documents.");
  const doc = readJson<DocJson>(join(dir, "doc.json"), { id: docId } as DocJson);
  return {
    doc,
    md: readFileSync(join(dir, "doc.md"), "utf8"),
    figures: readJson<FigureEntry[]>(join(dir, "figures.json"), []),
    dir,
  };
}

export function passageMaxChars(project: string): number {
  const n = readJson<Partial<ProjectJson>>(join(project, "project.json"), {}).rag?.passageMaxChars;
  return typeof n === "number" && n > 0 ? n : PASSAGE_MAX_CHARS;
}

export function normalizeAnchor(anchor: string): string {
  const a = anchor.trim();
  if (/^req[:\s]/i.test(a)) return `req:${a.slice(4).trim()}`;
  if (/^fig[:\s]/i.test(a)) return `fig:${a.slice(4).trim()}`;
  return `§${a.replace(/^§\s*/, "")}`;
}

const levelOf = (ls: string[], s: Section) => /^(#+)/.exec(ls[s.line])?.[1].length ?? 7;

export function sectionEnd(ls: string[], sections: Section[], s: Section): number {
  const next = sections.find((x) => x.line > s.line);
  return next ? next.line : ls.length;
}

export function outlineOf(md: string, s: Section): PassageOutlineItem[] {
  const ls = lines(md);
  const sections = parseSections(md);
  const lv = levelOf(ls, s);
  const out: PassageOutlineItem[] = [];
  for (const x of sections.filter((x) => x.line > s.line)) {
    if (levelOf(ls, x) <= lv) break;
    out.push({
      anchor: x.anchor,
      title: x.title,
      chars: stripComments(x.body).length,
      reqIds: [...new Set([...x.body.matchAll(/<!--\s*req\s+(\S+?)\s*-->/g)].map((m) => m[1]))],
      figureIds: [...new Set([...x.body.matchAll(/<!--\s*fig\s+(\S+?)\s*-->/g)].map((m) => m[1]))],
    });
  }
  return out;
}

const shown = (l: string) => stripComments(l).length + 1;

// ponytail: above the cap, keep whole lines around the focus (or from the top), and the header rows of the
// table the focus sits in, so a matrix row still reads as a row of its table
export function capLines(
  ls: string[],
  from: number,
  to: number,
  max: number,
  focus?: number,
): { text: string; truncated: boolean; a: number; b: number } {
  const all = stripComments(ls.slice(from, to).join("\n"));
  if (all.length <= max) return { text: all, truncated: false, a: from, b: to };
  const at = focus !== undefined && focus >= from && focus < to ? focus : from;
  let a = at;
  let b = at + 1;
  let size = shown(ls[at]);
  for (let grew = true; grew; ) {
    grew = false;
    if (b < to && size + shown(ls[b]) <= max) {
      size += shown(ls[b++]);
      grew = true;
    }
    if (a > from && size + shown(ls[a - 1]) <= max) {
      size += shown(ls[--a]);
      grew = true;
    }
  }
  const table = tablesOf(ls.join("\n")).find((t) => t.start < at && at < t.end && a > t.start);
  const head = table ? ls.slice(table.start, table.start + 2) : [];
  return { text: stripComments([...head, ...ls.slice(a, b)].join("\n")), truncated: true, a, b };
}

export function passage(project: string, ref: string): PassageView {
  const m = ref.match(/^([^#]+)#(.+)$/);
  if (!m) throw new UserError(`"${ref}" is not a source reference.`, "Write it docId#anchor, e.g. DOC#§5.6.6.");
  const docId = m[1];
  const { doc, md, figures } = readDoc(project, docId);
  const anchor = normalizeAnchor(m[2]);
  const ls = lines(md);
  const sections = parseSections(md);
  const all = docFigures(md, figures);
  const max = passageMaxChars(project);
  const entry = (f: (typeof all)[number]): FigureEntry => ({
    file: f.file,
    anchor: f.anchor,
    caption: f.caption,
    description: f.description,
  });
  const docInfo = {
    code: doc.code ?? docId,
    title: doc.title ?? "",
    version: doc.version ?? "",
    status: doc.status ?? "draft",
    binding: doc.binding ?? "informative",
  };
  const notFound = () =>
    new UserError(`${docId} has no anchor ${anchor}.`, "Open the document's doc.md to see its anchors.");
  if (anchor.startsWith("fig:")) {
    const f = all.find((x) => x.anchor === anchor);
    if (!f) throw notFound();
    const s = sectionAt(sections, markerLine(md, "fig", f.n));
    return {
      docId,
      anchor,
      path: s?.path ?? "",
      title: f.caption,
      text: [f.caption, f.description].filter(Boolean).join("\n"),
      figures: [entry(f)],
      doc: docInfo,
    };
  }
  const opts = evidenceOptions(project);
  const matrixAt = /^req:(.+?)@matrix(~\d+)?$/.exec(anchor);
  if (matrixAt) {
    const row = matrixRows(md, opts).find((r) => r.anchor === anchor);
    if (!row) throw notFound();
    const traced = row.traced[0];
    const target = traced ? sections.find((s) => s.number === traced) : undefined;
    const holder = sectionAt(sections, row.line);
    const t = row.matrix.table;
    return {
      docId,
      anchor,
      path: target?.path ?? holder?.path ?? "",
      title: target?.title ?? holder?.title ?? "",
      text: stripComments([...ls.slice(t.start, t.start + 2), ls[row.line]].join("\n")),
      figures: [],
      focus: row.statement,
      doc: docInfo,
    };
  }
  let focus: string | undefined;
  let focusLine: number | undefined;
  let s = sections.find((x) => x.anchor === anchor);
  if (anchor.startsWith("req:")) {
    const id = anchor.slice(4);
    const st = statementsOf(docId, md, opts).get(id);
    const at = markerLine(md, "req", id);
    if (!st && at < 0) throw notFound();
    focusLine = st?.start ?? at;
    s = sectionAt(sections, focusLine);
    focus = st?.text;
  }
  if (!s) throw notFound();
  const end = sectionEnd(ls, sections, s);
  const cut = capLines(ls, s.line + 1, end, max, focusLine);
  const inSection = new Set([...s.body.matchAll(/<!--\s*fig\s+(\S+?)\s*-->/g)].map((x) => x[1]));
  return {
    docId,
    anchor,
    path: s.path,
    title: s.title,
    text: cut.text,
    figures: all.filter((f) => inSection.has(f.n)).map(entry),
    doc: docInfo,
    ...(focus ? { focus } : {}),
    ...(cut.truncated
      ? {
          truncated: true,
          outline: outlineOf(md, s),
          readMore: `Read docs/${docId}/doc.md lines ${s.line + 1}–${end} for the whole section (${stripComments(s.body).length} characters; this passage shows lines ${cut.a + 1}–${cut.b}).`,
        }
      : {}),
  };
}

export function figure(project: string, docId: string, n: string): FigureView {
  const { md, figures, dir } = readDoc(project, docId);
  const key = n.replace(/^fig[:\s]*/i, "");
  const f = docFigures(md, figures).find((x) => x.n === key);
  if (!f)
    throw new UserError(`${docId} has no figure ${key}.`, "testimus rag passage <doc>#fig:<n> lists it if it exists.");
  const absPath = join(dir, f.file);
  return {
    docId,
    n: f.n,
    anchor: f.anchor,
    file: `docs/${docId}/${f.file}`,
    caption: f.caption,
    description: f.description,
    path: sectionAt(parseSections(md), markerLine(md, "fig", f.n))?.path ?? "",
    absPath,
    exists: existsSync(absPath),
  };
}
