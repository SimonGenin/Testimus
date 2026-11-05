import type { DatabaseSync } from "node:sqlite";
import { UserError } from "../command.ts";
import { natural } from "../lib/natural.ts";
import type { Edge, EdgeKind } from "../types.ts";
import { normalizeRef } from "./anchors.ts";
import { docFigures, markerLine, parseSections, sectionAt } from "./chunk.ts";
import { edgesOf, indexedContents, withIndex } from "./db.ts";
import { docEdges } from "./graph.ts";
import { corpusKey, projectDocs } from "./indexer.ts";

type Neighbour = {
  ref: string;
  kind: EdgeKind;
  direction: "out" | "in";
  title: string;
  path: string;
  depth: number;
};
export type Related = {
  ref: string;
  neighbours: Neighbour[];
  truncated?: true;
  total?: number;
};

// ponytail: depth 2 through a chapter with many subsections and cross-references reaches hundreds of neighbours —
// the list stops at RELATED_MAX (every depth-1 neighbour is always kept), `truncated` and `total` say what was left out
export const RELATED_MAX = 200;

type DocInfo = {
  id: string;
  title: string;
  md: string;
  sections: Map<string, { title: string; path: string }>;
  figures?: Map<string, { title: string; path: string }>;
};

type Graph = {
  docs: Map<string, DocInfo>;
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
};

const KIND_ORDER: EdgeKind[] = ["amends", "parent", "refers", "shows", "sibling"];

const cache = new Map<string, { key: string; graph: Graph }>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

// ponytail: the edges the index holds for a document indexed as it is now, else derived from doc.md the way the
// indexer does — the graph never depends on a model, so every PC gets the same neighbours (SPEC-RAG P1)
function graphOf(project: string): Graph {
  const docs = projectDocs(project);
  const key = corpusKey(project, docs);
  const hit = cache.get(project);
  if (hit?.key === key) return hit.graph;
  const read = (db: DatabaseSync | null): Graph => {
    const g: Graph = { docs: new Map(), out: new Map(), in: new Map() };
    const indexed = db ? indexedContents(db) : new Map<string, string>();
    for (const d of docs) {
      const edges =
        db && indexed.get(d.doc.id) === d.content ? edgesOf(db, d.doc.id) : docEdges(project, d.doc, d.md, d.figures);
      for (const e of edges) {
        push(g.out, e.from, e);
        push(g.in, e.to, e);
      }
      g.docs.set(d.doc.id, {
        id: d.doc.id,
        title: d.doc.title ?? "",
        md: d.md,
        sections: new Map(parseSections(d.md).map((s) => [s.anchor, { title: s.title, path: s.path }])),
      });
    }
    return g;
  };
  const g = withIndex(project, null, read) ?? read(null);
  cache.set(project, { key, graph: g });
  return g;
}

function figures(d: DocInfo): Map<string, { title: string; path: string }> {
  if (!d.figures) {
    const sections = parseSections(d.md);
    d.figures = new Map(
      docFigures(d.md, []).map((f) => [
        f.anchor,
        { title: f.caption, path: sectionAt(sections, markerLine(d.md, f.n))?.path ?? "" },
      ]),
    );
  }
  return d.figures;
}

function infoOf(g: Graph, ref: string): { title: string; path: string } {
  const m = ref.match(/^([^#]+)#(.+)$/);
  const d = g.docs.get(m ? m[1] : ref);
  if (!d) return { title: "", path: "" };
  if (!m) return { title: d.title, path: "" };
  const a = m[2];
  if (a.startsWith("§")) return d.sections.get(a) ?? { title: "", path: "" };
  if (a.startsWith("fig:")) return figures(d).get(a) ?? { title: "", path: "" };
  return { title: "", path: "" };
}

function exists(g: Graph, ref: string): boolean {
  const m = ref.match(/^([^#]+)#(.+)$/);
  const d = g.docs.get(m ? m[1] : ref);
  if (!d) return false;
  if (!m) return true;
  const a = m[2];
  if (a.startsWith("§")) return d.sections.has(a);
  if (a.startsWith("fig:")) return figures(d).has(a);
  return false;
}

const docOf = (ref: string) => ref.split("#")[0];

function direct(g: Graph, ref: string): { ref: string; kind: EdgeKind; direction: "out" | "in" }[] {
  const out = [
    ...(g.out.get(ref) ?? []).map((e) => ({ ref: e.to, kind: e.kind, direction: "out" as const })),
    ...(g.in.get(ref) ?? []).map((e) => ({ ref: e.from, kind: e.kind, direction: "in" as const })),
  ];
  const m = ref.match(/^([^#]+)#(.+)$/);
  if (!m) return out;
  const n = m[2].startsWith("§") ? m[2].slice(1) : "";
  const parts = n.split(".");
  for (let i = parts.length - 1; n && i > 0; i--)
    for (const e of g.in.get(`${m[1]}#§${parts.slice(0, i).join(".")}`) ?? [])
      if (e.kind === "amends") out.push({ ref: e.from, kind: "amends", direction: "in" });
  for (const e of g.in.get(m[1]) ?? [])
    if (e.kind === "amends") out.push({ ref: e.from, kind: "amends", direction: "in" });
  return out;
}

function origin(g: Graph, raw: string): string {
  const ref = normalizeRef(raw);
  const doc = docOf(ref);
  if (!g.docs.has(doc))
    throw new UserError(`No document ${doc} in this project.`, "testimus docs list shows the document ids.");
  if (!exists(g, ref))
    throw new UserError(`No anchor ${ref.slice(doc.length + 1)} in ${doc}.`, "Use §x.y or fig:N as in doc.md.");
  return ref;
}

export function refInfo(project: string, ref: string): { title: string; path: string } {
  return infoOf(graphOf(project), normalizeRef(ref));
}

const naturalCompare = natural;

export function related(project: string, input: { ref: string; depth?: number }): Related {
  const g = graphOf(project);
  const from = origin(g, input.ref);
  const depth = input.depth === 2 ? 2 : 1;
  const seen = new Set<string>([from]);
  const keys = new Set<string>();
  const neighbours: Neighbour[] = [];
  const add = (n: { ref: string; kind: EdgeKind; direction: "out" | "in" }, d: number) => {
    const key = n.kind === "sibling" ? `${n.ref} sibling` : `${n.ref} ${n.kind} ${n.direction}`;
    if (n.ref === from || keys.has(key)) return false;
    if (d === 2 && seen.has(n.ref)) return false;
    keys.add(key);
    neighbours.push({ ...n, ...infoOf(g, n.ref), depth: d });
    return true;
  };
  const first: { ref: string; kind: EdgeKind }[] = [];
  for (const n of direct(g, from)) if (add(n, 1)) first.push(n);
  for (const n of neighbours) seen.add(n.ref);
  if (depth === 2)
    for (const n of first) {
      if (n.kind === "sibling" || !n.ref.includes("#")) continue;
      for (const m of direct(g, n.ref)) add(m, 2);
    }
  const rank = (k: EdgeKind) => KIND_ORDER.indexOf(k);
  neighbours.sort(
    (a, b) =>
      a.depth - b.depth ||
      rank(a.kind) - rank(b.kind) ||
      (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) ||
      naturalCompare(a.ref, b.ref),
  );
  const keep = Math.max(RELATED_MAX, neighbours.filter((n) => n.depth === 1).length);
  return {
    ref: from,
    neighbours: neighbours.slice(0, keep),
    ...(neighbours.length > keep ? { truncated: true as const, total: neighbours.length } : {}),
  };
}
