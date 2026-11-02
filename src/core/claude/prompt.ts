import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../lib/project.ts";
import type { ClaudeScope, Context } from "../types.ts";

export function contextDir(project: string, id: string): string {
  return join(project, "contexts", id);
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
  if (scope.kind === "test") return [`Scope: the whole test ${scope.testId}.`, `Files: tests/${scope.testId}/test.md`];
  return [`Scope: step ${scope.step} of test ${scope.testId}.`, `Files: tests/${scope.testId}/test.md`];
}

export function buildPrompt(scope: ClaudeScope, request: string, contexts: Context[], project: string): string {
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
  const req = request.trim();
  if (req) lines.push("", req);
  lines.push("", "When finished, reply in 2-4 lines: what you changed (which steps) and anything you could not do.");
  return `${lines.join("\n")}\n`;
}

export function chatPrompt(question: string, language: string): string {
  return [
    "Use the ask-docs skill to answer this question about the project's documents.",
    "Answer only from the documents (rag_search, rag_passage, docs/*/doc.md), never from general knowledge.",
    'Put the source of every factual sentence at its end: [<docId>#<anchor> "<exact quote from doc.md>"].',
    "Say plainly when the documents do not answer. Do not edit any file.",
    `Answer in the language of the question (project language: ${language}).`,
    "",
    `Question: ${question.trim()}`,
    "",
  ].join("\n");
}
