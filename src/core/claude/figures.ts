import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { readJson, readProject, writeJson } from "../lib/project.ts";
import { docFigures, markerLine, parseSections, sectionAt } from "../rag/chunk.ts";
import type { DocJson, FigureEntry } from "../types.ts";
import { languageName } from "./generate.ts";
import { runClaude } from "./run.ts";

export const FIGURES_MARKER = "Testimus describe-figures run";
export const FIGURES_TAG = "figures";
export const FIGURES_BATCH = 20;

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
): string {
  return [
    `${FIGURES_MARKER} for the document ${doc.code || doc.id} ${doc.title}.`.replace(/\s+\./, "."),
    "",
    "Open each picture below with Read and describe it for a tester who will compare it with the screen of the",
    `simulator: one or two sentences in ${languageName(language)}, saying what is drawn — symbols, colours, labels,`,
    "texts, layout, states. Describe only what the picture and its caption show; no interpretation, no requirement.",
    "Do not edit any file.",
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
      .map((f) => `"${f.anchor}": "…"`)
      .join(", ")}}`,
    "```",
    "",
  ].join("\n");
}

const figKey = (k: string) => `fig:${k.trim().replace(/^fig[:\s]*/i, "")}`;

export function parseFigureDescriptions(text: string): Record<string, string> {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const ordered = [...blocks.filter((b) => b[1] === FIGURES_TAG), ...blocks.filter((b) => b[1] !== FIGURES_TAG)].map(
    (b) => b[2],
  );
  const bare = text.match(/\{[\s\S]*\}/)?.[0];
  if (bare) ordered.push(bare);
  for (const body of ordered) {
    try {
      const o = JSON.parse(body) as unknown;
      const out: Record<string, string> = {};
      if (Array.isArray(o)) {
        for (const e of o as Record<string, unknown>[])
          if (e && typeof e.anchor === "string" && typeof e.description === "string" && e.description.trim())
            out[figKey(e.anchor)] = e.description.trim();
      } else if (o && typeof o === "object")
        for (const [k, v] of Object.entries(o as Record<string, unknown>))
          if (typeof v === "string" && v.trim()) out[figKey(k)] = v.trim();
      if (Object.keys(out).length) return out;
    } catch {}
  }
  return {};
}

export async function describeFigures(
  project: string,
  docId: string,
  ctx: Ctx,
  opts: { force?: boolean; model?: string } = {},
): Promise<DescribeResult> {
  const dir = join(project, "docs", docId);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(docId) || !existsSync(join(dir, "doc.md")))
    throw new UserError(`No document ${docId} in this project.`, "testimus docs list shows the documents.");
  const doc = readJson<DocJson>(join(dir, "doc.json"), { id: docId, code: docId, title: "" } as DocJson);
  const md = readFileSync(join(dir, "doc.md"), "utf8");
  const file = join(dir, "figures.json");
  const entries = readJson<FigureEntry[]>(file, []);
  const sections = parseSections(md);
  const all = docFigures(md, entries);
  const todo: FigureTodo[] = all
    .filter((f) => f.file && (opts.force || !f.description.trim()))
    .map((f) => ({
      anchor: f.anchor,
      file: f.file,
      caption: f.caption,
      section: ((s) => (s ? `${s.number} ${s.title}`.trim() : ""))(sectionAt(sections, markerLine(md, "fig", f.n))),
    }));
  const res: DescribeResult = { docId, figures: all.length, described: 0, missing: [], runIds: [], costUsd: 0 };
  if (!todo.length) return res;
  const p = readProject(project);
  const got: Record<string, string> = {};
  for (let i = 0; i < todo.length; i += FIGURES_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = todo.slice(i, i + FIGURES_BATCH);
    ctx.progress({ message: `Describing the figures of ${docId}`, done: i, total: todo.length });
    const run = await runClaude({
      project,
      prompt: figuresPrompt(doc, batch, p.language),
      model: opts.model || p.claude.model,
      effort: "low",
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
    const parsed = parseFigureDescriptions(run.summary);
    for (const f of batch) if (parsed[f.anchor]) got[f.anchor] = parsed[f.anchor];
  }
  res.missing = todo.filter((f) => !got[f.anchor]).map((f) => f.anchor);
  res.described = todo.length - res.missing.length;
  if (res.described) {
    const byAnchor = new Map(entries.map((e) => [e.anchor, e]));
    const next: FigureEntry[] = all.map((f) => {
      const e = byAnchor.get(f.anchor);
      return {
        file: e?.file || f.file,
        anchor: f.anchor,
        caption: e?.caption || f.caption,
        description: got[f.anchor] ?? e?.description ?? f.description,
      };
    });
    for (const e of entries) if (!next.some((n) => n.anchor === e.anchor)) next.push(e);
    writeJson(file, next);
  }
  if (res.missing.length) ctx.log("warn", `${docId}: no description for ${res.missing.join(", ")}.`);
  ctx.progress({ message: `${res.described} figure(s) of ${docId} described`, done: todo.length, total: todo.length });
  return res;
}
