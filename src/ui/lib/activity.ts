import type { ClaudeEvent, JobEvent } from "../../core/types.ts";
import { resultLine } from "./jobs.ts";

export type PhaseKind = "prepare" | "read" | "plan" | "write" | "check" | "end";
export type Act = { at: string; text: string; level: "info" | "warn" | "error" };
export type Span = { from: number; to: number | null };
export type Phase = {
  kind: PhaseKind;
  from: string;
  to: string;
  acts: Act[];
  reads: { doc: string; spans: Span[] }[];
  searches: number;
  planned: string[];
  written: { id: string; summary: string; saves: number }[];
  failed: boolean;
};

type Step = {
  kind: PhaseKind | "aside";
  text: string;
  doc?: string;
  span?: Span;
  search?: boolean;
  plan?: string;
  write?: { id: string; summary: string };
};

function argsOf(input: string): Record<string, unknown> {
  try {
    const v = JSON.parse(input);
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {}
  // ponytail: the live events cut the input at 300 characters — the keys that came through are still read
  const out: Record<string, unknown> = {};
  for (const m of input.matchAll(/"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+)/g))
    try {
      out[m[1]] ??= JSON.parse(m[2]);
    } catch {}
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);
const docOf = (p: string) => p.match(/docs[\\/]+([^\\/]+)[\\/]+[^\\/]+$/)?.[1] ?? "";
const testOf = (p: string) => p.match(/tests[\\/]+(local-[0-9a-f]{8})[\\/]/i)?.[1]?.toLowerCase() ?? "";
const tail = (p: string) => p.split(/[\\/]/).slice(-2).join("/");
const quoted = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;

export const lines = (n: number) => n.toLocaleString("en-GB");

function stepOf(e: Extract<ClaudeEvent, { type: "tool" }>): Step {
  const a = argsOf(e.input);
  const name = e.name.replace(/^mcp__testimus__/, "");
  const path = str(a.file_path) || str(a.path);
  if (name === "Skill") return { kind: "prepare", text: `Opened the ${str(a.skill) || "skill"} instructions` };
  if (name === "Read" && /doc\.md$/.test(path)) {
    const doc = docOf(path);
    const off = num(a.offset);
    const limit = num(a.limit);
    const from = Math.max(1, off ?? 1);
    const to = limit ? from + limit - 1 : null;
    return {
      kind: "read",
      doc,
      span: { from, to },
      text: to ? `Read ${doc}, lines ${lines(from)}–${lines(to)}` : `Read ${doc} in one go`,
    };
  }
  if (name === "Read" && /context\.md$/.test(path))
    return { kind: "prepare", text: `Read the team notes on ${docOf(path)}` };
  if (name === "Read" && /CLAUDE\.md$/.test(path)) return { kind: "prepare", text: "Read the project instructions" };
  if (name === "Read" && testOf(path)) return { kind: "aside", text: `Opened ${testOf(path)}` };
  if (name === "Read") return { kind: "prepare", text: `Read ${tail(path)}` };
  if (name === "Grep" && /doc\.md|docs/.test(`${path} ${str(a.glob)}`))
    return { kind: "read", search: true, doc: docOf(path), text: `Searched for ${quoted(str(a.pattern))}` };
  if (name === "Grep") return { kind: "aside", text: `Searched the files for ${quoted(str(a.pattern))}` };
  if (name === "Glob") return { kind: "aside", text: `Listed ${str(a.pattern)}` };
  if (/^(Write|Edit|MultiEdit)$/.test(name) && testOf(path)) {
    const id = testOf(path);
    return { kind: "write", write: { id, summary: "" }, text: `Wrote ${id}` };
  }
  if (/^(Write|Edit|MultiEdit)$/.test(name)) return { kind: "aside", text: `Edited ${tail(path)}` };
  const where = `${str(a.docId)} ${str(a.anchor)}`.trim();
  if (name === "rag_search")
    return { kind: "read", search: true, text: `Searched the documents for ${quoted(str(a.query))}` };
  if (name === "rag_passage" || name === "rag_figure")
    return { kind: "read", search: true, doc: str(a.docId), text: `Read ${where}` };
  if (name === "rag_related") return { kind: "read", search: true, text: `Looked for what relates to ${where}` };
  if (name === "rag_mentions")
    return {
      kind: "read",
      search: true,
      text: `Looked for every mention of ${quoted(str(a.term) || str(a.query) || str(a.id))}`,
    };
  if (name === "docs_show") return { kind: "prepare", text: `Looked up ${str(a.id) || "a document"}` };
  if (name === "docs_list") return { kind: "prepare", text: "Listed the documents" };
  if (name === "tests_list") return { kind: "prepare", text: "Listed the existing tests" };
  if (name === "traces_list") return { kind: "prepare", text: "Listed the tracked ids" };
  if (name.startsWith("contexts_")) return { kind: "prepare", text: "Read the saved contexts" };
  if (name === "tests_create") {
    const s = str(a.summary) || "Untitled test";
    return { kind: "plan", plan: s, text: `Planned ${quoted(s)}` };
  }
  if (name === "tests_save" || name === "tests_edit") {
    const id = str(a.id);
    const summary = str(a.summary) || str((a.test as Record<string, unknown> | undefined)?.summary);
    const what = summary ? quoted(summary) : id;
    return {
      kind: "write",
      write: { id, summary },
      text: name === "tests_save" ? `Wrote the steps of ${what}` : `Corrected ${what}`,
    };
  }
  if (name === "tests_show") return { kind: "aside", text: `Opened ${str(a.id) || "a test"}` };
  if (/check/.test(name)) return { kind: "check", text: `Checked ${str(a.id) || "a test"}` };
  return { kind: "aside", text: `Used ${name.replace(/_/g, ".")}` };
}

function stepOfEvent(e: JobEvent): Step | (Act & { kind: "act" }) | null {
  if (e.type === "claude") {
    if (e.event.type === "tool") return stepOf(e.event);
    if (e.event.type === "result" && !e.event.ok)
      return { kind: "act", at: e.at, level: "error", text: `Claude stopped: ${e.event.text.slice(0, 160)}` };
    return null;
  }
  if (e.type === "progress") {
    if (/^(Reading passages|Writing local-)/.test(e.message)) return null;
    if (/^Checking /.test(e.message)) return { kind: "check", text: e.message };
    return { kind: "act", at: e.at, level: "info", text: e.message };
  }
  if (e.type === "log") return { kind: "act", at: e.at, level: e.level, text: e.message };
  if (e.type === "status" && e.job.status !== "running") return { kind: "end", text: resultLine(e.job) };
  return null;
}

const open = (kind: PhaseKind, at: string): Phase => ({
  kind,
  from: at,
  to: at,
  acts: [],
  reads: [],
  searches: 0,
  planned: [],
  written: [],
  failed: false,
});

// ponytail: a phase opens when Claude starts doing something else; a lookup in the middle of a phase (a test
// opened, the tracked ids listed) stays in the phase it interrupts
export function activityOf(events: JobEvent[]): Phase[] {
  const out: Phase[] = [];
  const names = new Map<string, string>();
  for (const e of events) {
    const s = stepOfEvent(e);
    if (!s) continue;
    let cur = out[out.length - 1];
    const minor = s.kind === "act" || s.kind === "aside" || (s.kind === "prepare" && !!cur);
    if (!cur || (!minor && s.kind !== cur.kind)) {
      cur = open(minor ? "prepare" : (s.kind as PhaseKind), e.at);
      out.push(cur);
    }
    cur.to = e.at;
    if (s.kind !== "act" && s.write) {
      const { id, summary } = s.write;
      if (summary) names.set(id, summary);
      else if (names.has(id)) {
        s.write.summary = names.get(id) ?? "";
        s.text = s.text.replace(id, `“${s.write.summary}”`);
      }
    }
    const level = s.kind === "act" ? s.level : s.kind === "end" && /^(Failed|Stopped)/.test(s.text) ? "error" : "info";
    cur.acts.push({ at: e.at, text: s.text, level });
    if (level === "error") cur.failed = true;
    if (s.kind === "act" || s.kind === "end") continue;
    if (s.search) cur.searches++;
    if (s.span && s.doc) {
      const r = cur.reads.find((x) => x.doc === s.doc);
      if (r) r.spans.push(s.span);
      else cur.reads.push({ doc: s.doc, spans: [s.span] });
    }
    if (s.plan) cur.planned.push(s.plan);
    if (s.write) {
      const w = cur.written.find((x) => x.id === s.write?.id);
      if (w) {
        w.saves++;
        w.summary ||= s.write.summary;
      } else cur.written.push({ ...s.write, saves: 1 });
    }
  }
  return out;
}

export function coverage(spans: Span[]): {
  last: number;
  read: number;
  twice: number;
  inOrder: boolean;
  whole: boolean;
} {
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const last = Math.max(0, ...known.map((s) => s.to));
  const seen = new Uint8Array(last + 1);
  let total = 0;
  for (const s of known)
    for (let i = s.from; i <= s.to; i++) {
      total++;
      if (seen[i] < 255) seen[i]++;
    }
  const read = seen.reduce((n, v) => n + (v ? 1 : 0), 0);
  const inOrder = known.every((s, i) => i === 0 || s.from > known[i - 1].from);
  return { last, read, twice: total - read, inOrder, whole: known.length < spans.length };
}

export function lasted(from: string, to: string): string {
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const DOING: Record<PhaseKind, string> = {
  prepare: "Getting ready",
  read: "Reading the documents",
  plan: "Planning the tests",
  write: "Writing the tests",
  check: "Checking the new tests",
  end: "Finishing",
};
