import { existsSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../../command.ts";
import { docDir, findDoc, readDocMd, readFigures } from "../../lib/docs.ts";
import { readProject } from "../../lib/project.ts";
import type { DocJson, FigureEntry, Passage, PassageOutlineItem } from "../../types.ts";
import { momentId, momentOf, normalizeAnchor } from "../anchors.ts";
import { docFigures, lines, markerLine, parseSections, type Section, sectionAt, stripComments } from "../chunk.ts";

type FigureView = FigureEntry & {
  docId: string;
  n: string;
  path: string;
  absPath: string;
  picture: boolean;
  exists: boolean;
};
export type PassageView = Passage & { quoteFound?: boolean };

export const PASSAGE_MAX_CHARS = 12_000;

function loadDoc(
  project: string,
  docId: string,
): { doc: Partial<DocJson>; md: string; figures: FigureEntry[]; dir: string } {
  const dir = docDir(project, docId);
  if (!existsSync(join(dir, "doc.md")))
    throw new UserError(`No document ${docId} in this project.`, "testimus docs list shows the documents.", "doc-gone");
  return {
    doc: findDoc(project, docId) ?? {},
    md: readDocMd(project, docId),
    figures: readFigures(project, docId),
    dir,
  };
}

export function passageMaxChars(project: string): number {
  const n = readProject(project).rag.passageMaxChars;
  return typeof n === "number" && n > 0 ? n : PASSAGE_MAX_CHARS;
}

const levelOf = (ls: string[], s: Section) => /^(#+)/.exec(ls[s.line])?.[1].length ?? 7;

function sectionEnd(ls: string[], sections: Section[], s: Section): number {
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
      figureIds: [...new Set([...x.body.matchAll(/<!--\s*fig\s+(\S+?)\s*-->/g)].map((m) => m[1]))],
    });
  }
  return out;
}

const shown = (l: string) => stripComments(l).length + 1;
const isSeparator = (line = "") => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

function tableStart(ls: string[], at: number): number {
  if (!ls[at]?.startsWith("|")) return -1;
  let start = at;
  while (start > 0 && ls[start - 1].startsWith("|")) start--;
  return isSeparator(ls[start + 1]) ? start : -1;
}

// ponytail: above the cap, keep whole lines around the focus (or from the top), and the header rows of the
// table the focus sits in, so a row still reads as a row of its table
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
  const start = tableStart(ls, at);
  const head = start >= 0 && start < at && a > start ? ls.slice(start, Math.min(start + 2, a)) : [];
  return { text: stripComments([...head, ...ls.slice(a, b)].join("\n")), truncated: true, a, b };
}

const squeeze = (s: string) => stripComments(s).replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// ponytail: the line where a quote starts inside [from, to), found whitespace- and case-folded the way the check and
// the Review highlight read it (a quote may run over several lines)
function quoteLine(ls: string[], from: number, to: number, quote: string): number | null {
  const q = squeeze(quote);
  if (!q) return null;
  let joined = "";
  const starts: number[] = [];
  for (let i = from; i < to; i++) {
    const t = squeeze(ls[i]);
    if (!t) continue;
    starts.push(joined.length, i);
    joined += `${t} `;
  }
  const at = joined.indexOf(q);
  if (at < 0) return null;
  let line = from;
  for (let k = 0; k < starts.length; k += 2) if (starts[k] <= at) line = starts[k + 1];
  return line;
}

export function passage(project: string, ref: string, around?: string): PassageView {
  const m = ref.match(/^([^#]+)#(.+)$/);
  if (!m) throw new UserError(`"${ref}" is not a source reference.`, "Write it docId#anchor, e.g. DOC#§5.6.6.");
  const docId = m[1];
  const { doc, md, figures } = loadDoc(project, docId);
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
  };
  const notFound = () =>
    new UserError(`${docId} has no anchor ${anchor}.`, "Open the document's doc.md to see its anchors.");
  if (anchor.startsWith("fig:")) {
    const f = all.find((x) => x.anchor === anchor);
    if (!f) throw notFound();
    const s = sectionAt(sections, markerLine(md, f.n));
    return {
      docId,
      anchor,
      path: s?.path ?? "",
      title: f.caption,
      text: [f.caption, f.description].filter(Boolean).join("\n"),
      figures: [{ ...entry(f), ...(f.table ? { table: f.table } : {}) }],
      doc: docInfo,
    };
  }
  // ponytail: a picture of an images or video document reads like a figure (its caption, what Claude saw); a
  // transcript line reads with the lines that follow it, up to the passage cap or the next section
  if (anchor.startsWith("img:") || anchor.startsWith("frame:")) {
    const marker = `<!-- ${anchor.replace(":", " ")} -->`;
    const at = ls.findIndex((l) => l.includes(marker));
    if (at < 0) throw notFound();
    const s = sectionAt(sections, at);
    const f = figures.find((x) => x.anchor === anchor);
    const caption = f?.caption || /!\[([^\]]*)\]/.exec(ls[at])?.[1] || "";
    const file = f?.file || /\]\(([^)\s]+)/.exec(ls[at])?.[1] || "";
    return {
      docId,
      anchor,
      path: s?.path ?? "",
      doc: docInfo,
      title: caption,
      text: [caption, f?.description ?? "", f?.labels?.length ? `Visible text: ${f.labels.join(" · ")}` : ""]
        .filter(Boolean)
        .join("\n"),
      figures: [{ file, anchor, caption, description: f?.description ?? "" }],
    };
  }
  // ponytail: a moment of a video is read by time, never by a line's own anchor — t:04:31 is the line being said at
  // 04:31 and those after it (to the end of a range, else up to the passage cap), each with its translation; v: is
  // what the key frames of the range show
  if (anchor.startsWith("t:") || anchor.startsWith("v:")) {
    const m = momentOf(anchor.slice(2));
    if (!m) throw notFound();
    const of = (kind: string) =>
      ls.flatMap((l, i) => {
        const x = new RegExp(`<!--\\s*${kind}\\s+(\\S+?)\\s*-->`).exec(l);
        const mm = x ? momentOf(x[1]) : null;
        return mm && mm.n === m.n ? [{ i, at: mm.at }] : [];
      });
    const said = of("t");
    const shown = of("frame");
    if (!said.length && !shown.length) throw notFound();
    const s = sectionAt(sections, (said[0] ?? shown[0]).i);
    const base = { docId, anchor, path: s?.path ?? "", doc: docInfo, title: s?.title ?? "" };
    const frameOf = (x: { i: number; at: number }) => {
      const a = `frame:${momentId(m.n, x.at)}`;
      const f = figures.find((e) => e.anchor === a);
      const caption = f?.caption || /!\[([^\]]*)\]/.exec(ls[x.i])?.[1] || "";
      return {
        file: f?.file || /\]\(([^)\s]+)/.exec(ls[x.i])?.[1] || "",
        anchor: a,
        caption,
        description: f?.description ?? "",
      };
    };
    if (anchor.startsWith("v:")) {
      const seen = shown.filter((x) => x.at >= m.at - 0.5 && x.at <= (m.to ?? m.at) + 0.5).map(frameOf);
      return {
        ...base,
        text: seen.map((f) => [f.caption, f.description].filter(Boolean).join("\n")).join("\n\n"),
        figures: seen,
      };
    }
    const first = said.findLast((x) => x.at <= m.at) ?? said[0];
    const out: string[] = [];
    let last = first?.at ?? m.at;
    for (const x of said.filter((y) => first && y.at >= first.at)) {
      if (m.to !== undefined && x.at > m.to) break;
      const tr = /<!--\s*(?:[a-z]{2,3}\s+)?=\s*(.*?)\s*-->/.exec(ls[x.i])?.[1];
      const t = tr ? `${stripComments(ls[x.i])}\n  = ${tr}` : stripComments(ls[x.i]);
      if (out.length && out.join("\n").length + t.length > max) break;
      out.push(t);
      last = x.at;
    }
    return {
      ...base,
      text: out.join("\n"),
      figures: shown.filter((x) => m.to !== undefined && x.at >= m.at && x.at <= Math.max(last, m.to)).map(frameOf),
    };
  }
  const s = sections.find((x) => x.anchor === anchor);
  if (!s) throw notFound();
  const end = sectionEnd(ls, sections, s);
  const quoted = around?.trim() ? quoteLine(ls, s.line + 1, end, around) : undefined;
  const cut = capLines(ls, s.line + 1, end, max, quoted ?? undefined);
  const inSection = new Set([...s.body.matchAll(/<!--\s*fig\s+(\S+?)\s*-->/g)].map((x) => x[1]));
  return {
    docId,
    anchor,
    path: s.path,
    title: s.title,
    text: cut.text,
    figures: all.filter((f) => inSection.has(f.n)).map(entry),
    doc: docInfo,
    ...(quoted !== undefined ? { quoteFound: quoted !== null } : {}),
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
  const { md, figures, dir } = loadDoc(project, docId);
  const key = n.replace(/^fig[:\s]*/i, "");
  const f = docFigures(md, figures).find((x) => x.n === key);
  if (!f)
    throw new UserError(`${docId} has no figure ${key}.`, "testimus rag passage <doc>#fig:<n> lists it if it exists.");
  const absPath = f.file ? join(dir, f.file) : "";
  return {
    docId,
    n: f.n,
    anchor: f.anchor,
    file: f.file ? `docs/${docId}/${f.file}` : "",
    caption: f.caption,
    description: f.description,
    path: sectionAt(parseSections(md), markerLine(md, f.n))?.path ?? "",
    absPath,
    picture: !!f.file,
    exists: !!f.file && existsSync(absPath),
  };
}
