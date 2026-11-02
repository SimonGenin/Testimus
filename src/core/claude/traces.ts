import { readProject, readXray } from "../lib/project.ts";
import { compile, scanTrace } from "../lib/traces.ts";
import type { ClaudeEvent, Diagnosis, TraceScan } from "../types.ts";
import { languageName } from "./generate.ts";
import { runClaude } from "./run.ts";

export const TRACE_MARKER = "Testimus tracked-ids proposal";
export const TRACE_TAG = "trace";

export type TraceProposal = { label: string; patterns: string[]; field: string; why: string };
export type ProposeResult = {
  ok: boolean;
  proposal: TraceProposal | null;
  preview: TraceScan | null;
  column: "in-xray" | "local" | null;
  summary: string;
  costUsd?: number;
  diagnosis?: Diagnosis;
};

export function tracePrompt(ask: string, language: string, columns: string[]): string {
  return [
    `${TRACE_MARKER}. The team wants to track this in its specification documents:`,
    "",
    `« ${ask.trim()} »`,
    "",
    "The documents are converted to Markdown in docs/<id>/doc.md. Find, with Grep and Read on those files only,",
    "the identifiers the team means (requirement ids, alarm codes, use cases, signal names…): codes that are",
    "written in the text and that a test step could list as « verified here ». Look at several documents and",
    "at real occurrences before you decide. Do not edit any file.",
    "",
    "Then propose how to recognise them:",
    "- patterns: JavaScript regular expressions without flags, that match the identifier itself and nothing",
    "  around it (use \\b), as few as possible; they must not match ordinary words;",
    `- label: what one of them is called, singular, in ${languageName(language)} (e.g. Exigence, Code alarme);`,
    `- field: the Xray step column that will hold them${columns.length ? `; reuse one of these existing custom columns when it fits: ${columns.join(", ")}` : ""};`,
    "- why: one sentence on what you found (how many, in which documents, an example).",
    "If the documents hold nothing like it, give an empty patterns list and say so in why.",
    "",
    "Reply with only this block:",
    "```" + TRACE_TAG,
    '{"label": "…", "patterns": ["…"], "field": "…", "why": "…"}',
    "```",
    "",
  ].join("\n");
}

export function parseProposal(text: string): TraceProposal | null {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  for (const b of [...blocks.filter((x) => x[1] === TRACE_TAG), ...blocks.filter((x) => x[1] !== TRACE_TAG)]) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object") continue;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const patterns = Array.isArray(o.patterns) ? o.patterns.map(str).filter(Boolean) : [];
      return { label: str(o.label), patterns, field: str(o.field), why: str(o.why) };
    } catch {}
  }
  return null;
}

export async function proposeTrace(o: {
  project: string;
  ask: string;
  model?: string;
  signal?: AbortSignal;
  onEvent?(e: ClaudeEvent): void;
}): Promise<ProposeResult> {
  const p = readProject(o.project);
  const xray = readXray(o.project);
  const custom = xray.fields.filter((f) => !f.builtin).map((f) => f.name);
  const run = await runClaude({
    kind: "traces",
    project: o.project,
    prompt: tracePrompt(o.ask, p.language, custom),
    model: o.model ?? p.claude.model,
    effort: "low",
    signal: o.signal,
    onEvent: o.onEvent,
  });
  const base = { summary: run.summary, costUsd: run.costUsd, diagnosis: run.diagnosis };
  if (!run.ok) return { ok: false, proposal: null, preview: null, column: null, ...base };
  const proposal = parseProposal(run.summary);
  if (!proposal) return { ok: false, proposal: null, preview: null, column: null, ...base };
  let preview: TraceScan | null = null;
  if (proposal.patterns.length)
    try {
      compile(proposal.patterns);
      preview = scanTrace(o.project, proposal.patterns, { limit: 12 });
    } catch (e) {
      proposal.why = `${proposal.why} (${(e as Error).message})`.trim();
    }
  const column = proposal.field ? (xray.fields.some((f) => f.name === proposal.field) ? "in-xray" : "local") : null;
  return { ok: true, proposal, preview, column, ...base };
}
