import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../lib/csv.ts";
import { readJson } from "../lib/project.ts";
import type { DocJson, Edge, EdgeKind, FigureEntry } from "../types.ts";
import { parseSections, type Section, stripComments } from "./chunk.ts";
import { type EvidenceOpts, evidenceOptions, idsIn, statementsOf } from "./statements.ts";

type OtherDoc = { id: string; names: string[]; sections: Set<string>; reqs: Set<string> };

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

function otherDocs(project: string, self: string): OtherDoc[] {
  const root = join(project, "docs");
  if (!existsSync(root)) return [];
  const out: OtherDoc[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === self || !existsSync(join(root, e.name, "doc.md"))) continue;
    const doc = readJson<Partial<DocJson>>(join(root, e.name, "doc.json"), {});
    const md = readFileSync(join(root, e.name, "doc.md"), "utf8");
    const sections = new Set([...md.matchAll(/<!--\s*§\s*(\S+?)\s*-->/g)].map((m) => m[1]));
    out.push({
      id: doc.id ?? e.name,
      names: [...new Set([e.name, doc.id, doc.code].filter(Boolean) as string[])],
      sections,
      reqs: new Set([...md.matchAll(/<!--\s*req\s+(\S+?)\s*-->/g)].map((m) => m[1])),
    });
  }
  return out;
}

function csvTraces(project: string, doc: DocJson): { id: string; chapter: string }[] {
  const file = join(project, "requirements", "requirements.csv");
  if (!existsSync(file)) return [];
  const t = parseCsv(readFileSync(file, "utf8"));
  const col = (re: RegExp) => t.headers.findIndex((h) => re.test(h.trim()));
  const id = col(/^(id|exigence|requirement)$/i);
  const d = col(/^doc(ument)?$/i);
  const ch = col(/^(chapter|chapitre|section)$/i);
  if (id < 0 || d < 0 || ch < 0) return [];
  const names = new Set([doc.id, doc.code].filter(Boolean));
  return t.rows
    .filter((r) => names.has((r[d] ?? "").trim()))
    .flatMap((r) =>
      [...(r[ch] ?? "").matchAll(/\d+(?:\.\d+)*/g)].map((m) => ({ id: (r[id] ?? "").trim(), chapter: m[0] })),
    )
    .filter((x) => x.id);
}

const ownText = (s: Section) => `${s.title}\n${stripComments(s.body)}`.replace(/\*/g, "");

// ponytail: the graph is model-independent and rebuilt with the chunks; a reference is full (docId#anchor), a
// document-level amendment is the bare docId
export function docEdges(project: string, doc: DocJson, md: string, _figures: FigureEntry[]): Edge[] {
  const opts: EvidenceOpts = evidenceOptions(project);
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

  const others = otherDocs(project, doc.id);
  const amended = others.filter(
    (o) => (doc.amends ?? []).includes(o.id) || o.names.some((n) => doc.amends?.includes(n)),
  );
  for (const st of statementsOf(doc.id, md, opts).values()) {
    if (st.section) add(ref(`req:${st.id}`), ref(st.section), "defines");
    for (const t of st.traced) if (has(t.slice(1))) add(ref(`req:${st.id}`), ref(t), "traces");
    for (const a of amended) if (a.reqs.has(st.id)) add(ref(`req:${st.id}`), `${a.id}#req:${st.id}`, "amends");
  }
  for (const t of csvTraces(project, doc)) if (has(t.chapter)) add(ref(`req:${t.id}`), ref(`§${t.chapter}`), "traces");

  for (const a of amended) add(doc.id, a.id, "amends");

  for (const s of sections) {
    const from = ref(s.anchor);
    const text = ownText(s);
    for (const id of idsIn(stripComments(s.body), opts)) add(from, ref(`req:${id}`), "mentions");
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
  for (const g of groups.values())
    for (const a of g) for (const b of g) if (a !== b) add(ref(a.anchor), ref(b.anchor), "sibling");
  return out;
}
