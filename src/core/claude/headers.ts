import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, readProject, readSettings } from "../lib/project.ts";
import type { Chunk, DocJson } from "../types.ts";
import { languageName } from "./generate.ts";
import { docRunLines, type JobRun } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const HEADERS_MARKER = "Testimus context-headers run";
export const HEADERS_TAG = "headers";
export const HEADERS_BATCH = 40;
const EXCERPT = 1200;

export function claudeHeadersOn(project: string): boolean {
  return (readProject(project).rag as { claudeHeaders?: boolean }).claudeHeaders === true;
}

// ponytail: the indexer's hook is given the document, not the project — the project is the known
// folder whose docs/<id>/doc.json is this very conversion (same convertedAt and source hash)
export function projectOfDoc(doc: DocJson): string | null {
  const s = readSettings();
  const candidates = [process.env.TESTIMUS_PROJECT, process.cwd(), s.lastProject, ...s.projects].filter(
    (p): p is string => !!p,
  );
  for (const dir of [...new Set(candidates.map((p) => resolve(p)))]) {
    const file = join(dir, "docs", doc.id, "doc.json");
    if (!existsSync(file)) continue;
    const d = readJson<Partial<DocJson>>(file, {});
    if (d.convertedAt === doc.convertedAt && d.source?.sha256 === doc.source?.sha256) return dir;
  }
  return null;
}

export function headersPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  chunks: Chunk[],
  language: string,
  extra: string[] = [],
): string {
  return [
    `${HEADERS_MARKER} for the document ${doc.code || doc.id} ${doc.title}.`.replace(/\s+\./, "."),
    "",
    "Each passage below is a part of this document, cut out for a search index. For each one, write one short",
    `sentence in ${languageName(language)} that situates it in the document so the passage can be found on its own:`,
    "which document, which object or screen, what the passage specifies. Name the objects as the document does.",
    "Use only the text given here; read nothing else and do not edit any file.",
    ...extra,
    "",
    ...chunks.flatMap((c) => [
      `=== ${c.id} (${c.path || c.anchor})`,
      c.text.length > EXCERPT ? `${c.text.slice(0, EXCERPT)}…` : c.text,
      "",
    ]),
    "Reply with only this block, one entry per passage, keyed by its id:",
    "```" + HEADERS_TAG,
    `{"${chunks[0]?.id ?? "<id>"}": "…"}`,
    "```",
    "",
  ].join("\n");
}

export function parseHeaders(text: string, chunks: Chunk[]): string[] {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const bodies = [...blocks.filter((b) => b[1] === HEADERS_TAG), ...blocks.filter((b) => b[1] !== HEADERS_TAG)].map(
    (b) => b[2],
  );
  for (const body of bodies) {
    try {
      const o = JSON.parse(body) as Record<string, unknown>;
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      return chunks.map((c) => (typeof o[c.id] === "string" ? (o[c.id] as string).replace(/\s+/g, " ").trim() : ""));
    } catch {}
  }
  return chunks.map(() => "");
}

// ponytail: off unless project.json rag.claudeHeaders is true — on 900 pages it costs hundreds of
// runs; an empty answer leaves every default header in place, a throw makes the indexer warn
export async function claudeHeaders(
  doc: DocJson,
  chunks: Chunk[],
  signal: AbortSignal,
  project?: string,
  claude: JobRun = {},
): Promise<string[]> {
  const dir = project ?? projectOfDoc(doc);
  if (!dir || !claudeHeadersOn(dir) || !chunks.length) return [];
  const p = readProject(dir);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i += HEADERS_BATCH) {
    if (signal.aborted) throw new Error("Cancelled.");
    const batch = chunks.slice(i, i + HEADERS_BATCH);
    const run = await runClaude({
      project: dir,
      prompt: headersPrompt(doc, batch, p.language, docRunLines(dir, doc.id, { note: claude.note })),
      model: claude.model || "haiku",
      effort: claude.effort || "low",
      kind: "headers",
      signal,
    });
    if (!run.ok) throw new Error(run.summary || "Claude did not answer.");
    out.push(...parseHeaders(run.summary, batch).map((s, j) => (s ? `${batch[j].header}\n${s}` : "")));
  }
  return out;
}
