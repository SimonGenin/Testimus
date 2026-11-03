import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { findDoc, readDocMd, readFigures, writeFigures } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { docFigures, markerLine, parseSections, sectionAt } from "../rag/chunk.ts";
import type { DocJson, FigureEntry } from "../types.ts";
import { languageName } from "./generate.ts";
import { docContexts, docRunLines, type JobRun } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const FIGURES_MARKER = "Testimus describe-figures run";
export const FIGURES_TAG = "figures";
export const FIGURES_BATCH = 20;
export const MAX_LABELS = 100;
export const FIGURE_KINDS: FigureKind[] = ["screen", "diagram", "symbol", "table-image", "photo"];

type FigureKind = NonNullable<FigureEntry["kind"]>;
export type Described = Pick<FigureEntry, "description" | "labels" | "kind">;
export type FigureTodo = { anchor: string; file: string; caption: string; section: string };
export type DescribeResult = {
  docId: string;
  figures: number;
  described: number;
  missing: string[];
  runIds: string[];
  costUsd: number;
};

const slash = (p: string) => p.replace(/\\/g, "/");

export function shouldDescribeFigures(project: string): boolean {
  return (readProject(project).rag as { describeFigures?: boolean }).describeFigures !== false;
}

export function figuresPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  todo: FigureTodo[],
  language: string,
  extra: string[] = [],
): string {
  return [
    `${FIGURES_MARKER} for the document ${doc.code || doc.id} ${doc.title}.`.replace(/\s+\./, "."),
    "",
    "Open each picture below with Read, look at it, and give for a tester who will compare it with the screen of",
    "the simulator:",
    `- description: one or two sentences in ${languageName(language)}, saying what is drawn — symbols, colours,`,
    "  layout, states. Only what the picture and its caption show; no interpretation, no expected behaviour.",
    "- labels: every text visible in the picture, copied verbatim (same spelling, accents, case, abbreviations;",
    `  never translated or corrected), one entry per title, button, menu item, field, legend or symbol name; at most ${MAX_LABELS}; [] when the picture has no text.`,
    `- kind: one of ${FIGURE_KINDS.join(", ")} (screen = a software window or screenshot, diagram = a drawing, plan or`,
    "  flow, symbol = one pictogram or a legend of symbols, table-image = a table pasted as a picture, photo).",
    "Do not edit any file.",
    ...extra,
    "",
    ...todo.map(
      (f) =>
        `- ${f.anchor} — docs/${slash(doc.id)}/${slash(f.file)}${f.caption ? ` — caption: "${f.caption}"` : ""}${f.section ? ` — section ${f.section}` : ""}`,
    ),
    "",
    "Reply with only this block, one entry per picture, keyed by its anchor:",
    "```" + FIGURES_TAG,
    `{${todo
      .slice(0, 2)
      .map((f) => `"${f.anchor}": {"description": "…", "labels": ["…"], "kind": "screen"}`)
      .join(", ")}}`,
    "```",
    "",
  ].join("\n");
}

const figKey = (k: string) => `fig:${k.trim().replace(/^fig[:\s]*/i, "")}`;

function described(v: unknown): Described | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.description !== "string" || !o.description.trim()) return null;
  const out: Described = { description: o.description.trim() };
  if (Array.isArray(o.labels))
    out.labels = [
      ...new Set(o.labels.filter((l): l is string => typeof l === "string").map((l) => l.replace(/\s+/g, " ").trim())),
    ]
      .filter(Boolean)
      .slice(0, MAX_LABELS);
  if (typeof o.kind === "string" && (FIGURE_KINDS as string[]).includes(o.kind)) out.kind = o.kind as FigureKind;
  return out;
}

// ponytail: a reply maps each anchor to { description, labels, kind }, as an object or a list of entries with their anchor
export function parseFigures(text: string): Record<string, Described> {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const ordered = [...blocks.filter((b) => b[1] === FIGURES_TAG), ...blocks.filter((b) => b[1] !== FIGURES_TAG)].map(
    (b) => b[2],
  );
  const bare = text.match(/\{[\s\S]*\}/)?.[0];
  if (bare) ordered.push(bare);
  for (const body of ordered) {
    try {
      const o = JSON.parse(body) as unknown;
      const out: Record<string, Described> = {};
      if (Array.isArray(o)) {
        for (const e of o as Record<string, unknown>[]) {
          const d = e && typeof e.anchor === "string" ? described(e) : null;
          if (d) out[figKey(e.anchor as string)] = d;
        }
      } else if (o && typeof o === "object")
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          const d = described(v);
          if (d) out[figKey(k)] = d;
        }
      if (Object.keys(out).length) return out;
    } catch {}
  }
  return {};
}

export async function describeFigures(
  project: string,
  docId: string,
  ctx: Ctx,
  opts: { force?: boolean } & JobRun = {},
): Promise<DescribeResult> {
  const dir = join(project, "docs", docId);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(docId) || !existsSync(join(dir, "doc.md")))
    throw new UserError(`No document ${docId} in this project.`, "testimus docs list shows the documents.");
  const doc = findDoc(project, docId) ?? ({ id: docId, code: docId, title: "" } as DocJson);
  const md = readDocMd(project, docId);
  const entries = readFigures(project, docId);
  const sections = parseSections(md);
  const all = docFigures(md, entries);
  const todo: FigureTodo[] = all
    .filter((f) => f.file && (opts.force || !f.description.trim()))
    .map((f) => ({
      anchor: f.anchor,
      file: f.file,
      caption: f.caption,
      section: ((s) => (s ? `${s.number} ${s.title}`.trim() : ""))(sectionAt(sections, markerLine(md, f.n))),
    }));
  const res: DescribeResult = { docId, figures: all.length, described: 0, missing: [], runIds: [], costUsd: 0 };
  if (!todo.length) return res;
  const p = readProject(project);
  const got: Record<string, Described> = {};
  const byAnchor = new Map(entries.map((e) => [e.anchor, e]));
  // ponytail: written after every batch, so a long document cut short keeps what Claude already described
  const save = () => {
    const next: FigureEntry[] = all.map((f) => {
      const e = byAnchor.get(f.anchor);
      const d = got[f.anchor];
      const labels = d ? (d.labels ?? e?.labels) : e?.labels;
      const kind = d ? (d.kind ?? e?.kind) : e?.kind;
      return {
        file: e?.file || f.file,
        anchor: f.anchor,
        caption: e?.caption || f.caption,
        description: d?.description ?? e?.description ?? f.description,
        ...(labels ? { labels } : {}),
        ...(kind ? { kind } : {}),
      };
    });
    for (const e of entries) if (!next.some((n) => n.anchor === e.anchor)) next.push(e);
    writeFigures(project, docId, next);
  };
  for (let i = 0; i < todo.length; i += FIGURES_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = todo.slice(i, i + FIGURES_BATCH);
    ctx.progress({ message: `Describing the figures of ${docId}`, done: i, total: todo.length });
    const run = await runClaude({
      project,
      prompt: figuresPrompt(doc, batch, p.language, docRunLines(project, docId, opts)),
      contexts: docContexts(project, docId, opts),
      model: opts.model || p.claude.model,
      effort: opts.effort || "low",
      kind: "figures",
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    res.runIds.push(run.runId);
    res.costUsd += run.costUsd ?? 0;
    if (!run.ok) {
      ctx.log("warn", `Figure descriptions of ${docId}: ${run.summary}`);
      continue;
    }
    const parsed = parseFigures(run.summary);
    let any = false;
    for (const f of batch)
      if (parsed[f.anchor]) {
        got[f.anchor] = parsed[f.anchor];
        any = true;
      }
    if (any) save();
  }
  res.missing = todo.filter((f) => !got[f.anchor]).map((f) => f.anchor);
  res.described = todo.length - res.missing.length;
  if (res.missing.length) ctx.log("warn", `${docId}: no description for ${res.missing.join(", ")}.`);
  ctx.progress({ message: `${res.described} figure(s) of ${docId} described`, done: todo.length, total: todo.length });
  return res;
}
