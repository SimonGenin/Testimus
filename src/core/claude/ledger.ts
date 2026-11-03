import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readFigures } from "../lib/docs.ts";
import { readJson, writeJson } from "../lib/project.ts";
import { docFigures, parseSections, type Section } from "../rag/chunk.ts";
import { normalizeRef } from "../rag/related.ts";
import type { GenInput } from "./gen-prompt.ts";
import type { TestPlan } from "./gen-reply.ts";
import type { ToolCall } from "./stream.ts";

export type Searched = { tool: string; query: string };
export type Ledger = { consulted: string[]; searched: Searched[] };

// ponytail: .testimus/gen/<generation>.json — one per generation (named by its job, or the generation it resumes):
// what was asked, the run, the tests written, what the run opened and searched, its plan; the full result is
// added when the generation ends. Written by generate.ts, read here only
export type GenLedger = Ledger & {
  at?: string;
  input?: GenInput;
  runId?: string;
  tests?: string[];
  plan?: TestPlan;
  done?: number[];
  reportedConsulted?: string[];
};

const genLedgerFile = (project: string, generation: string) => join(project, ".testimus", "gen", `${generation}.json`);

export function writeLedger(project: string, generation: string, ledger: GenLedger & Record<string, unknown>): void {
  writeJson(genLedgerFile(project, generation), ledger);
}

const DOC_MD = /(?:^|[\\/])docs[\\/]+([^\\/]+)[\\/]+doc\.md$/i;
const FIGURE = /(?:^|[\\/])docs[\\/]+([^\\/]+)[\\/]+figures[\\/]+([^\\/]+)$/i;
const READ_LIMIT = 2000;

type Doc = { md: string; sections: Section[]; ends: number[] };

const toolOf = (name: string) => name.replace(/^mcp__testimus__/, "");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d);

// ponytail: what the generation really opened, read from its stream-json tool calls, never from its own report
// (SPEC-RAG §5.3) — rag_passage / rag_figure / rag_related refs, Read ranges of doc.md mapped to the sections they
// cross, Read of a figure image; searches (rag_search, rag_mentions, Grep on the documents) go to `searched`
export function ledgerOf(project: string, calls: ToolCall[]): Ledger {
  const docs = new Map<string, Doc | null>();
  const docOf = (id: string): Doc | null => {
    if (!docs.has(id)) {
      const file = join(project, "docs", id, "doc.md");
      if (!existsSync(file)) docs.set(id, null);
      else {
        const md = readFileSync(file, "utf8");
        const sections = parseSections(md);
        const total = md.split("\n").length;
        docs.set(id, { md, sections, ends: sections.map((_, i) => sections[i + 1]?.line ?? total) });
      }
    }
    return docs.get(id) ?? null;
  };
  const consulted: string[] = [];
  const seen = new Set<string>();
  const open = (ref: string) => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    consulted.push(ref);
  };
  const openRef = (raw: string) => {
    const ref = normalizeRef(raw);
    if (/^[^#]+#.+$/.test(ref)) open(ref);
  };
  const searched: Searched[] = [];
  const search = (tool: string, query: string) => {
    if (query && !searched.some((s) => s.tool === tool && s.query === query)) searched.push({ tool, query });
  };

  for (const c of calls) {
    if (c.error) continue;
    const tool = toolOf(c.name);
    const i = c.input;
    if (tool === "rag_passage" && str(i.ref)) openRef(str(i.ref));
    else if (tool === "rag_related" && str(i.ref)) openRef(str(i.ref));
    else if (tool === "rag_figure" && str(i.docId) && str(i.n))
      open(`${str(i.docId)}#fig:${str(i.n).replace(/^fig:/, "")}`);
    else if (tool === "rag_search") search(tool, str(i.query));
    else if (tool === "rag_mentions") search(tool, str(i.term));
    else if (tool === "Grep") {
      const where = `${str(i.path)} ${str(i.glob)}`;
      if (!str(i.path) || /docs|doc\.md/i.test(where)) search("Grep", str(i.pattern));
    } else if (tool === "Read") {
      const file = str(i.file_path);
      const md = file.match(DOC_MD);
      if (md) {
        const d = docOf(md[1]);
        if (!d) continue;
        const lo = num(i.offset, 1) - 1;
        const hi = lo + num(i.limit, READ_LIMIT);
        d.sections.forEach((s, k) => {
          if (s.line < hi && d.ends[k] > lo) open(`${md[1]}#${s.anchor}`);
        });
        continue;
      }
      const fig = file.match(FIGURE);
      if (fig) {
        const d = docOf(fig[1]);
        if (!d) continue;
        const entries = readFigures(project, fig[1]);
        const f = docFigures(d.md, entries).find(
          (x) => x.file.split("/").pop()?.toLowerCase() === fig[2].toLowerCase(),
        );
        if (f) open(`${fig[1]}#${f.anchor}`);
      }
    }
  }
  return { consulted, searched };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function readLedger(project: string, jobId: string | undefined): (GenLedger & { jobId: string }) | null {
  if (!jobId || !/^[\w.-]+$/.test(jobId)) return null;
  const l = readJson<Record<string, unknown> | null>(genLedgerFile(project, jobId), null);
  if (!l || !Array.isArray(l.consulted)) return null;
  return {
    jobId,
    consulted: strings(l.consulted),
    searched: Array.isArray(l.searched)
      ? l.searched.filter((s): s is Searched => !!s && typeof s.tool === "string" && typeof s.query === "string")
      : [],
    ...(typeof l.at === "string" ? { at: l.at } : {}),
    ...(l.input && typeof l.input === "object" ? { input: l.input as GenInput } : {}),
    ...(typeof l.runId === "string" ? { runId: l.runId } : {}),
    ...(Array.isArray(l.tests) ? { tests: strings(l.tests) } : {}),
    ...(l.plan && typeof l.plan === "object" ? { plan: l.plan as TestPlan } : {}),
    ...(Array.isArray(l.done) ? { done: l.done.filter((n): n is number => typeof n === "number") } : {}),
    ...(Array.isArray(l.reportedConsulted) ? { reportedConsulted: strings(l.reportedConsulted) } : {}),
  };
}

// ponytail: a section counts as read when it, or a section above it, was opened — a passage or a Read of §5.6
// shows §5.6.6 too
export function covers(consulted: string[], ref: string): boolean {
  const set = new Set(consulted);
  if (set.has(ref)) return true;
  const m = ref.match(/^([^#]+)#§(.+)$/);
  if (!m) return false;
  const parts = m[2].split(".");
  for (let i = parts.length - 1; i > 0; i--) if (set.has(`${m[1]}#§${parts.slice(0, i).join(".")}`)) return true;
  return false;
}
