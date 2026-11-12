import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findDoc } from "../lib/docs.ts";
import type { DocJson, Edge, EdgeKind, FigureEntry } from "../types.ts";
import { parseSections, type Section, stripComments } from "./chunk.ts";

export type CorpusDoc = { id: string; names: string[]; sections: Set<string> };

const NUM = String.raw`(\d+(?:\.\d+)*)`;
const KEYWORD = "(?:chapitres?|paragraphes?|sections?)";
const SAME_DOC: RegExp[] = [
  new RegExp(String.raw`§\s*${NUM}`, "g"),
  new RegExp(String.raw`\bcf\.?\s*(?:(?:le|la|au)\s+)?(?:${KEYWORD}\s+)?${NUM}`, "gi"),
  new RegExp(String.raw`\bvoir\s+(?:(?:le|la|les|au|aux)\s+)?${KEYWORD}\s+${NUM}`, "gi"),
  new RegExp(String.raw`\b${KEYWORD}\s+(\d+(?:\.\d+)+)`, "gi"),
];
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimNum = (n: string) => n.replace(/\.+$/, "");

// ponytail: every document's names and section numbers, read once per index run — reading them again for each
// document made the graph quadratic (9 s of a blocked core for 125 documents)
export function corpusOf(project: string): CorpusDoc[] {
  const root = join(project, "docs");
  if (!existsSync(root)) return [];
  const out: CorpusDoc[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(root, e.name, "doc.md"))) continue;
    const doc: Partial<DocJson> = findDoc(project, e.name) ?? {};
    const md = readFileSync(join(root, e.name, "doc.md"), "utf8");
    const sections = new Set([...md.matchAll(/<!--\s*§\s*(\S+?)\s*-->/g)].map((m) => m[1]));
    out.push({
      id: doc.id ?? e.name,
      names: [...new Set([e.name, doc.id, doc.code].filter(Boolean) as string[])],
      sections,
    });
  }
  return out;
}

const ownText = (s: Section) => `${s.title}\n${stripComments(s.body)}`.replace(/\*/g, "");

// ponytail: the graph is model-independent and rebuilt with the chunks; a reference is full (docId#anchor), a
// document-level amendment is the bare docId
export function docEdges(
  project: string,
  doc: DocJson,
  md: string,
  _figures: FigureEntry[],
  corpus: CorpusDoc[] = corpusOf(project),
): Edge[] {
  const sections = parseSections(md);
  const numbered = new Map(sections.filter((s) => s.number).map((s) => [s.number, s]));
  const has = (n: string) => numbered.has(n);
  const ref = (anchor: string) => `${doc.id}#${anchor}`;
  const out: Edge[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string, kind: EdgeKind) => {
    const key = `${from} ${to} ${kind}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, kind, docId: doc.id });
  };

  const others = corpus.filter((o) => o.names[0] !== doc.id);
  const amended = others.filter(
    (o) => (doc.amends ?? []).includes(o.id) || o.names.some((n) => doc.amends?.includes(n)),
  );
  for (const a of amended) add(doc.id, a.id, "amends");

  for (const s of sections) {
    const from = ref(s.anchor);
    const text = ownText(s);
    for (const f of s.body.matchAll(/<!--\s*fig\s+(\S+?)\s*-->/g)) add(from, ref(`fig:${f[1]}`), "shows");

    const taken: [number, number][] = [];
    for (const o of others) {
      const re = new RegExp(String.raw`(?:${o.names.map(reEscape).join("|")})\s*,?\s*(?:§|${KEYWORD})\s*${NUM}`, "gi");
      for (const m of text.matchAll(re)) {
        const n = trimNum(m[1]);
        taken.push([m.index, m.index + m[0].length]);
        if (!o.sections.has(n)) continue;
        add(from, `${o.id}#§${n}`, amended.includes(o) ? "amends" : "refers");
      }
    }
    for (const re of SAME_DOC)
      for (const m of text.matchAll(re)) {
        if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
        const n = trimNum(m[1]);
        if (has(n)) add(from, ref(`§${n}`), "refers");
        else {
          const target = amended.filter((a) => a.sections.has(n));
          if (target.length === 1) add(from, `${target[0].id}#§${n}`, "amends");
        }
      }
  }

  for (const s of numbered.values()) {
    const parent = s.number.split(".").slice(0, -1).join(".");
    if (parent && has(parent)) add(ref(s.anchor), ref(`§${parent}`), "parent");
  }
  const groups = new Map<string, Section[]>();
  for (const s of numbered.values()) {
    const parent = s.number.split(".").slice(0, -1).join(".");
    groups.set(parent, [...(groups.get(parent) ?? []), s]);
  }
  // ponytail: a section without a number (a requirement under « 5.6.6 Sectionneur ») hangs from the heading above
  // it, and the unnumbered sections of one heading are siblings — a specification written as requirements is linked
  // like one written as numbered sections
  const under = new Map<string, Section[]>();
  for (const s of sections) {
    if (s.number || !s.parent) continue;
    add(ref(s.anchor), ref(s.parent), "parent");
    under.set(s.parent, [...(under.get(s.parent) ?? []), s]);
  }
  for (const g of [...groups.values(), ...under.values()])
    for (const a of g) for (const b of g) if (a !== b) add(ref(a.anchor), ref(b.anchor), "sibling");
  return out;
}
