import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { readJson, readProject, writeJson } from "../lib/project.ts";
import { testDir } from "../lib/store.ts";
import type { ClaudeScope, Context } from "../types.ts";

export const sharedContexts = (): string => join(env.dataDir(), "contexts");

// ponytail: a project's own context wins; any other id is looked up in the shared library every project sees
// (Xray Editor keeps its contexts in the workspace, for all projects)
export function contextDir(project: string, id: string): string {
  const own = join(project, "contexts", id);
  if (existsSync(own)) return own;
  const shared = join(sharedContexts(), id);
  return existsSync(shared) ? shared : own;
}

export const isShared = (project: string, id: string): boolean =>
  !existsSync(join(project, "contexts", id)) && existsSync(join(sharedContexts(), id));

const testClaudeFile = (project: string, testId: string) => join(testDir(project, testId), "claude.json");

export function readTestContexts(project: string, testId: string): string[] | null {
  const f = testClaudeFile(project, testId);
  if (!existsSync(f)) return null;
  const c = readJson<{ contexts?: unknown }>(f, {}).contexts;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string" && /^[\w-]+$/.test(x)) : null;
}

export function writeTestContexts(project: string, testId: string, ids: string[] | null): void {
  const f = testClaudeFile(project, testId);
  if (ids === null) rmSync(f, { force: true });
  else writeJson(f, { contexts: [...new Set(ids)] });
}

// ponytail: the test's own list wins whole (Xray Editor §7), else the project's; ids whose folder is gone drop out
export function effectiveContexts(project: string, testId?: string): string[] {
  const own = testId ? readTestContexts(project, testId) : null;
  const ids = own ?? readProject(project).claude.contexts;
  return ids.filter((id) => /^[\w-]+$/.test(id) && existsSync(contextDir(project, id)));
}

export function readContexts(project: string, ids: string[]): Context[] {
  const out: Context[] = [];
  for (const id of ids) {
    if (!/^[\w-]+$/.test(id)) continue;
    const dir = contextDir(project, id);
    if (!existsSync(dir)) continue;
    const meta = readJson<{ name?: string; paths?: string[] }>(join(dir, "context.json"), {});
    const notes = join(dir, "notes.md");
    const files = join(dir, "files");
    out.push({
      id,
      name: meta.name || id,
      text: existsSync(notes) ? readFileSync(notes, "utf8") : "",
      paths: Array.isArray(meta.paths) ? meta.paths : [],
      files: existsSync(files) ? readdirSync(files) : [],
    });
  }
  return out;
}

const slash = (p: string) => p.replace(/\\/g, "/");

export function scopeLines(scope: ClaudeScope): string[] {
  if (scope.kind === "project") return ["Scope: every test of this project.", "Files: all tests/*/test.md"];
  if (scope.kind === "tests")
    return [
      `Scope: the tests ${scope.testIds.join(", ")}.`,
      `Files: ${scope.testIds.map((id) => `tests/${id}/test.md`).join(", ")}`,
    ];
  if (scope.kind === "doc")
    return [
      `Scope: the document ${scope.docId} and the tests that cite it.`,
      `Files: docs/${scope.docId}/ (through the docs_* tools only) and the tests/*/test.md whose sources cite it`,
    ];
  if (scope.kind === "test") return [`Scope: the whole test ${scope.testId}.`, `Files: tests/${scope.testId}/test.md`];
  return [`Scope: step ${scope.step} of test ${scope.testId}.`, `Files: tests/${scope.testId}/test.md`];
}

export function buildPrompt(
  scope: ClaudeScope,
  request: string,
  contexts: Context[],
  project: string,
  note = "",
): string {
  const lines = [...scopeLines(scope), "Only modify what the scope allows."];
  if (scope.kind === "step")
    lines.push(
      `Only edit "## Step ${scope.step}" of that file (its fields and its ### Sources); do not touch other steps.`,
    );
  lines.push(
    "Follow the test.md format of CLAUDE.md exactly. Every claim keeps or gets its source line: " +
      '`<docId>#<anchor> "<exact quote from doc.md>"` — use rag_search and rag_passage to find them.',
    "The screenshots listed under ### Attachments are files in tests/<id>/images/ — open them with Read when what the screen shows matters.",
  );
  lines.push(...contextLines(project, contexts, note));
  const req = request.trim();
  if (req) lines.push("", req);
  lines.push("", "When finished, reply in 2-4 lines: what you changed (which steps) and anything you could not do.");
  return `${lines.join("\n")}\n`;
}

// ponytail: the saved contexts are pointed at (Claude reads their files), the note of this run is said in full
export function contextLines(project: string, contexts: Context[], note = ""): string[] {
  const lines: string[] = [];
  if (contexts.length) {
    lines.push("", "Context to read before you start (reference material, do not edit it):");
    for (const c of contexts) {
      const dir = slash(contextDir(project, c.id));
      const parts: string[] = [];
      if (c.text.trim()) parts.push(`notes: ${dir}/notes.md`);
      if (c.files.length) parts.push(`files: ${c.files.map((f) => `${dir}/files/${f}`).join(", ")}`);
      if (c.paths.length) parts.push(`also look at: ${c.paths.join(", ")}`);
      lines.push(`- ${c.name}${parts.length ? ` — ${parts.join("; ")}` : ""}`);
    }
  }
  if (note.trim()) lines.push("", "Additional context from the user for this run:", note.trim());
  return lines;
}

export function chatPrompt(question: string, language: string, context: string[] = []): string {
  return [
    "Use the ask-docs skill to answer this question about the project's documents.",
    "Answer only from the documents (rag_search, rag_passage, docs/*/doc.md), never from general knowledge.",
    'Put the source of every factual sentence at its end: [<docId>#<anchor> "<exact quote from doc.md>"].',
    "Say plainly when the documents do not answer. Do not edit any file.",
    `Answer in the language of the question (project language: ${language}).`,
    ...context,
    "",
    `Question: ${question.trim()}`,
    "",
  ].join("\n");
}
