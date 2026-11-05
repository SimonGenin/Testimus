import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { docDir, readDoc, readFigures, tocOf, writeFigures } from "../lib/docs.ts";
import { bodyOf, findLot, itemFigure, ordered, photoFigure, readLotContext, updateLot } from "../lib/media.ts";
import { readProject } from "../lib/project.ts";
import { normalizeAnchor } from "../rag/anchors.ts";
import type { DocJson, MediaLot } from "../types.ts";
import { type Described, described, FIGURES_BATCH, parseEntries } from "./figures.ts";
import { languageName } from "./gen-prompt.ts";
import { docContexts, docRunLines, type JobRun } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const MEDIA_MARKER = "Testimus media run";
export const MEDIA_TAG = "media";
const MAX_TOC = 300;

export type PhotoTodo = { anchor: string; file: string; name: string; takenAt?: string };
export type Read = Described & { sections: string[] };
export type AnalyseResult = { analysed: number; missing: string[]; runIds: string[]; costUsd: number };

const slash = (p: string) => p.replace(/\\/g, "/");

export function mediaPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  lot: Pick<MediaLot, "id" | "title">,
  context: string,
  toc: { anchor: string; title: string }[],
  todo: PhotoTodo[],
  language: string,
  extra: string[] = [],
): string {
  const shown = toc.slice(0, MAX_TOC);
  return [
    `${MEDIA_MARKER} for the batch « ${lot.title} » (lot-${lot.id}) of the document ${doc.code || doc.id} ${doc.title}.`.replace(
      /\s+\./,
      ".",
    ),
    "",
    "These are photos of the real system (screens of the simulator, a desk, a cabin), taken by the team. They show",
    "what the system does and how a tester gets there — never what it is required to do: say what you see, never",
    "what should happen.",
    "",
    ...(context ? ["What the team says about this batch:", context, ""] : []),
    "Open each photo below with Read, look at it, and give:",
    `- description: two to four sentences in ${languageName(language)} for a tester: which screen or object it is,`,
    "  what state it shows, where things are and what the operator does or can do there.",
    "- labels: every text visible in the photo, copied verbatim (same spelling, accents, case, abbreviations; never",
    "  translated or corrected), one entry per title, button, menu item, field or message; [] when none is readable.",
    "- kind: one of screen, diagram, symbol, table-image, photo (screen = a software window, photo = anything else).",
    "- sections: the anchors of the document's sections this photo illustrates, from the outline below (you may",
    `  search the document with rag_search or read docs/${slash(doc.id)}/doc.md); [] when none.`,
    "Do not edit any file.",
    ...extra,
    "",
    "Outline of the document:",
    ...shown.map((t) => `- ${t.anchor} ${t.title}`),
    ...(toc.length > shown.length ? [`- … ${toc.length - shown.length} more sections`] : []),
    "",
    "Photos:",
    ...todo.map(
      (p) =>
        `- ${p.anchor} — docs/${slash(doc.id)}/${slash(p.file)} — ${p.name}${p.takenAt ? ` — taken ${p.takenAt.replace("T", " ").slice(0, 16)}` : ""}`,
    ),
    "",
    "Reply with only this block, one entry per photo, keyed by its anchor:",
    "```" + MEDIA_TAG,
    `{${todo
      .slice(0, 2)
      .map((p) => `"${p.anchor}": {"description": "…", "labels": ["…"], "kind": "screen", "sections": ["§…"]}`)
      .join(", ")}}`,
    "```",
    "",
  ].join("\n");
}

const photoKey = (k: string) => `fig:${k.trim().replace(/^fig[:\s]*/i, "")}`;

function read(v: unknown): Read | null {
  const d = described(v);
  if (!d) return null;
  const raw = (v as { sections?: unknown }).sections;
  const sections = Array.isArray(raw)
    ? [...new Set(raw.filter((s): s is string => typeof s === "string" && !!s.trim()).map(normalizeAnchor))]
    : [];
  return { ...d, sections };
}

export function parseMedia(text: string): Record<string, Read> {
  return parseEntries(text, MEDIA_TAG, photoKey, read);
}

// ponytail: Claude reads the photos of a batch 20 at a time, with the batch's context and the document's outline; what it
// read is saved after every run (a long batch cut short keeps it), and a section it names that the body does not have
// is dropped
export async function analyseLot(
  project: string,
  docId: string,
  lotId: string,
  ctx: Ctx,
  opts: { items?: string[]; force?: boolean } & JobRun = {},
): Promise<AnalyseResult> {
  const doc = readDoc(project, docId);
  const lot = findLot(doc, lotId);
  const todo: PhotoTodo[] = ordered(lot.items)
    .filter((i) => i.figure && i.state !== "failed")
    .filter((i) => (opts.items ? opts.items.includes(i.id) : opts.force || i.state !== "analysed"))
    .map((i) => ({
      anchor: itemFigure(lot.id, i.id),
      file: i.figure as string,
      name: i.name,
      ...(i.takenAt ? { takenAt: i.takenAt } : {}),
    }));
  const res: AnalyseResult = { analysed: 0, missing: [], runIds: [], costUsd: 0 };
  if (!todo.length) return res;
  const p = readProject(project);
  const toc = tocOf(bodyOf(docDir(project, docId)) ?? "");
  const known = new Set(toc.map((t) => t.anchor));
  const context = readLotContext(project, docId, lotId);
  const model = opts.model || p.claude.model;
  const effort = opts.effort || "low";
  const got = new Set<string>();
  for (let i = 0; i < todo.length; i += FIGURES_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = todo.slice(i, i + FIGURES_BATCH);
    ctx.progress({ message: `Claude reads the photos of « ${lot.title} »`, done: i, total: todo.length });
    const run = await runClaude({
      project,
      prompt: mediaPrompt(doc, lot, context, toc, batch, p.language, docRunLines(project, docId, opts)),
      contexts: docContexts(project, docId, opts),
      model,
      effort,
      kind: "media",
      label: `Photos of ${lot.title}`,
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    res.runIds.push(run.runId);
    res.costUsd += run.costUsd ?? 0;
    if (!run.ok) {
      ctx.log("warn", `Photos of « ${lot.title} »: ${run.summary}`);
      continue;
    }
    const parsed = parseMedia(run.summary);
    const here = batch.filter((t) => parsed[t.anchor]);
    if (!here.length) continue;
    const figures = readFigures(project, docId);
    updateLot(project, docId, lotId, (l) => {
      for (const t of here) {
        const r = parsed[t.anchor];
        const it = l.items.find((x) => itemFigure(l.id, x.id) === t.anchor);
        if (!it) continue;
        got.add(t.anchor);
        it.state = "analysed";
        const sections = r.sections.filter((s) => known.has(s));
        if (sections.length) it.illustrates = sections;
        else delete it.illustrates;
        const at = figures.findIndex((f) => f.anchor === t.anchor);
        const entry = {
          ...photoFigure(l, it, at >= 0 ? figures[at] : undefined),
          description: r.description,
          ...(r.labels ? { labels: r.labels } : {}),
          ...(r.kind ? { kind: r.kind } : {}),
        };
        if (at >= 0) figures[at] = entry;
        else figures.push(entry);
      }
      l.analysed = { at: env.now().toISOString(), model, effort };
    });
    writeFigures(project, docId, figures);
  }
  res.missing = todo.filter((t) => !got.has(t.anchor)).map((t) => t.anchor);
  res.analysed = todo.length - res.missing.length;
  if (res.missing.length) ctx.log("warn", `« ${lot.title} »: Claude read nothing for ${res.missing.join(", ")}.`);
  return res;
}
