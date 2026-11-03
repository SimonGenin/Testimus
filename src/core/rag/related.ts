import { existsSync, statSync } from "node:fs";
import { UserError } from "../command.ts";
import type { Edge, EdgeKind } from "../types.ts";
import { docFigures, lines, parseSections, sectionAt } from "./chunk.ts";
import { edgesOf, indexFile, openDb } from "./db.ts";
import { docEdges } from "./graph.ts";
import { projectDocs } from "./indexer.ts";
import { evidenceOptions, type Statement, statementsOf } from "./statements.ts";

export type Neighbour = {
  ref: string;
  kind: EdgeKind;
  direction: "out" | "in";
  title: string;
  path: string;
  depth: number;
};
export type Related = {
  ref: string;
  statement?: { id: string; source: "body" | "matrix"; section: string; text: string };
  neighbours: Neighbour[];
  warnings: string[];
  truncated?: true;
  total?: number;
};

// ponytail: depth 2 through a matrix section reaches every requirement it covers (~1 000 on J5) — the list stops
// at RELATED_MAX (every depth-1 neighbour is always kept), `truncated` and `total` say what was left out
export const RELATED_MAX = 200;

type DocInfo = {
  id: string;
  title: string;
  amends: string[];
  md: string;
  sections: Map<string, { title: string; path: string }>;
  figures?: Map<string, { title: string; path: string }>;
  statements?: Map<string, Statement>;
};

type Graph = {
  docs: Map<string, DocInfo>;
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
  reqs: Map<string, string[]>;
  project: string;
};

const KIND_ORDER: EdgeKind[] = ["defines", "traces", "amends", "parent", "refers", "mentions", "shows", "sibling"];

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
  const file = indexFile(project);
  const hasIndex = existsSync(file);
  const key = [hasIndex ? statSync(file).mtimeMs : 0, ...docs.map((d) => `${d.doc.id}:${d.content}`)].join("\n");
  const hit = cache.get(project);
  if (hit?.key === key) return hit.graph;
  const db = hasIndex ? openDb(file) : null;
  const g: Graph = { docs: new Map(), out: new Map(), in: new Map(), reqs: new Map(), project };
  try {
    const indexed = new Map<string, string>();
    if (db)
      for (const r of db.prepare("select doc_id, content from docs").all() as { doc_id: string; content: string }[])
        indexed.set(r.doc_id, r.content);
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
        amends: d.doc.amends ?? [],
        md: d.md,
        sections: new Map(parseSections(d.md).map((s) => [s.anchor, { title: s.title, path: s.path }])),
      });
      for (const m of d.md.matchAll(/<!--\s*req\s+(\S+?)\s*-->/g)) {
        const ref = `${d.doc.id}#req:${m[1]}`;
        const list = g.reqs.get(m[1]) ?? [];
        if (!list.includes(ref)) g.reqs.set(m[1], [...list, ref]);
      }
    }
    for (const e of [...g.out.values()].flat())
      for (const ref of [e.from, e.to]) {
        const m = ref.match(/^([^#]+)#req:(.+)$/);
        if (!m || !g.docs.has(m[1])) continue;
        const list = g.reqs.get(m[2]) ?? [];
        if (!list.includes(ref)) g.reqs.set(m[2], [...list, ref]);
      }
  } finally {
    db?.close();
  }
  cache.set(project, { key, graph: g });
  return g;
}

function statements(g: Graph, d: DocInfo): Map<string, Statement> {
  d.statements ??= statementsOf(d.id, d.md, evidenceOptions(g.project));
  return d.statements;
}

function figures(d: DocInfo): Map<string, { title: string; path: string }> {
  if (!d.figures) {
    const sections = parseSections(d.md);
    const ls = lines(d.md);
    d.figures = new Map(
      docFigures(d.md, []).map((f) => {
        const line = ls.findIndex((l) =>
          new RegExp(String.raw`<!--\s*fig\s+${f.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*-->`).test(l),
        );
        return [f.anchor, { title: f.caption, path: sectionAt(sections, line)?.path ?? "" }];
      }),
    );
  }
  return d.figures;
}

export function normalizeRef(ref: string): string {
  const m = ref.trim().match(/^([^#]+)#(.+)$/);
  if (!m) return ref.trim();
  let a = m[2].trim().replace(/~\d+$/, "");
  const k = a.match(/^(req|fig)\s*[:\s]\s*(.+)$/i);
  if (k) a = `${k[1].toLowerCase()}:${k[2].trim()}`;
  else a = `§${a.replace(/^§\s*/, "")}`;
  a = a.replace(/@matrix(~\d+)?$/, "");
  return `${m[1].trim()}#${a}`;
}

function infoOf(g: Graph, ref: string): { title: string; path: string } {
  const m = ref.match(/^([^#]+)#(.+)$/);
  const d = g.docs.get(m ? m[1] : ref);
  if (!d) return { title: "", path: "" };
  if (!m) return { title: d.title, path: "" };
  const a = m[2];
  if (a.startsWith("§")) return d.sections.get(a) ?? { title: "", path: "" };
  if (a.startsWith("fig:")) return figures(d).get(a) ?? { title: "", path: "" };
  if (a.startsWith("req:")) {
    const st = statements(g, d).get(a.slice(4));
    if (!st) return { title: a.slice(4), path: "" };
    const text = st.text.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
    return {
      title: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      path: d.sections.get(st.section)?.path ?? "",
    };
  }
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
  if (a.startsWith("req:")) return statements(g, d).has(a.slice(4)) || g.out.has(ref) || g.in.has(ref);
  return false;
}

const docOf = (ref: string) => ref.split("#")[0];
const isAncestor = (a: string, b: string) => b.startsWith(`${a}.`);

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

function origins(g: Graph, raw: string): string[] {
  const ref = normalizeRef(raw);
  if (ref.includes("#")) {
    const doc = docOf(ref);
    if (!g.docs.has(doc))
      throw new UserError(`No document ${doc} in this project.`, "testimus docs list shows the document ids.");
    if (!exists(g, ref))
      throw new UserError(
        `No anchor ${ref.slice(doc.length + 1)} in ${doc}.`,
        "Use §x.y, req:ID or fig:N as in doc.md.",
      );
    return [ref];
  }
  if (g.docs.has(ref)) return [ref];
  const refs = g.reqs.get(ref);
  if (!refs?.length)
    throw new UserError(
      `No document carries ${ref}.`,
      "Give docId#anchor (§x.y, req:ID, fig:N) or a requirement id present in a document.",
    );
  return [...refs].sort();
}

function warningsFor(g: Graph, ref: string): string[] {
  const m = ref.match(/^([^#]+)#req:(.+)$/);
  const d = m && g.docs.get(m[1]);
  if (!m || !d) return [];
  const st = statements(g, d).get(m[2]);
  if (!st?.section || st.source !== "body") return [];
  const defined = st.section.slice(1);
  const ok = (n: string) => n === defined || isAncestor(n, defined);
  const out: string[] = [];
  for (const e of g.out.get(ref) ?? []) {
    if (e.kind !== "traces") continue;
    const n = e.to.split("#§")[1] ?? "";
    if (n && !ok(n))
      out.push(
        `${m[2]}: traced to ${e.to} but defined in ${m[1]}#${st.section} — the matrix and the body may disagree.`,
      );
  }
  for (const t of st.traced)
    if (!d.sections.has(t) && !ok(t.slice(1)))
      out.push(
        `${m[2]}: traced to ${t} by the matrix, a section ${m[1]} does not have (defined in ${m[1]}#${st.section}).`,
      );
  return out;
}

export function refInfo(project: string, ref: string): { title: string; path: string } {
  return infoOf(graphOf(project), normalizeRef(ref));
}

export type StatementHit = {
  docId: string;
  id: string;
  source: "body" | "matrix";
  section: string;
  text: string;
  path: string;
  header: string;
};

const idAlone = (s: Statement) =>
  s.text
    .replace(/[*`]/g, "")
    .replace(/[\s:.,–—-]+$/, "")
    .trim() === s.id;

// ponytail: the specification states a requirement, a document that amends it (doc.json.amends, a PA) comments on
// it — so text before the id alone, a document that amends nothing before one that does, a body statement before a
// matrix row, then document order
function bestStatement(g: Graph, sts: Statement[]): Statement | undefined {
  const rank = (s: Statement) =>
    (idAlone(s) ? 4 : 0) + (g.docs.get(s.docId)?.amends.length ? 2 : 0) + (s.source === "body" ? 0 : 1);
  return [...sts].sort((a, b) => rank(a) - rank(b))[0];
}

export function statementOf(project: string, id: string): StatementHit | null {
  const g = graphOf(project);
  const found: Statement[] = [];
  for (const ref of [...(g.reqs.get(id) ?? [])].sort()) {
    const d = g.docs.get(docOf(ref));
    const st = d ? statements(g, d).get(id) : undefined;
    if (st) found.push(st);
  }
  const st = bestStatement(g, found);
  if (!st) return null;
  const d = g.docs.get(st.docId) as DocInfo;
  const s = d.sections.get(st.section);
  return {
    docId: st.docId,
    id,
    source: st.source,
    section: st.section,
    text: st.text,
    path: s?.path ?? "",
    header: `${d.id} ${d.title} — ${s ? `${s.path} ${s.title}` : st.section}`.trim(),
  };
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

export function related(project: string, input: { ref: string; depth?: number }): Related {
  const g = graphOf(project);
  const from = origins(g, input.ref);
  const depth = input.depth === 2 ? 2 : 1;
  const seen = new Set<string>(from);
  const keys = new Set<string>();
  const neighbours: Neighbour[] = [];
  const add = (n: { ref: string; kind: EdgeKind; direction: "out" | "in" }, d: number) => {
    const key = n.kind === "sibling" ? `${n.ref} sibling` : `${n.ref} ${n.kind} ${n.direction}`;
    if (from.includes(n.ref) || keys.has(key)) return false;
    if (d === 2 && seen.has(n.ref)) return false;
    keys.add(key);
    neighbours.push({ ...n, ...infoOf(g, n.ref), depth: d });
    return true;
  };
  const first: { ref: string; kind: EdgeKind }[] = [];
  for (const o of from) for (const n of direct(g, o)) if (add(n, 1)) first.push(n);
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

  let statement: Related["statement"];
  const reqs = from.filter((r) => r.includes("#req:"));
  const sts = reqs
    .map((r) => {
      const d = g.docs.get(docOf(r));
      return d ? statements(g, d).get(r.split("#req:")[1]) : undefined;
    })
    .filter((s): s is Statement => !!s);
  const best = bestStatement(g, sts);
  if (best) statement = { id: best.id, source: best.source, section: `${best.docId}#${best.section}`, text: best.text };
  const shown = from.length === 1 ? from[0] : input.ref.trim();
  const keep = Math.max(RELATED_MAX, neighbours.filter((n) => n.depth === 1).length);
  return {
    ref: shown,
    ...(statement ? { statement } : {}),
    neighbours: neighbours.slice(0, keep),
    warnings: from.flatMap((r) => warningsFor(g, r)),
    ...(neighbours.length > keep ? { truncated: true as const, total: neighbours.length } : {}),
  };
}
