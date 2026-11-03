import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { findDoc, readContext, readDoc, writeDoc } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { readLocal, testDir, writeLocal } from "../lib/store.ts";
import type { ClaudeRun, ClaudeScope, Context } from "../types.ts";

export type JobRun = ClaudeRun & { note?: string; contexts?: string[] };

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

export function readTestContexts(project: string, testId: string): string[] | null {
  testDir(project, testId);
  return readLocal(project, testId).contexts ?? null;
}

export function writeTestContexts(project: string, testId: string, ids: string[] | null): void {
  writeLocal(project, testId, { ...readLocal(project, testId), contexts: ids ?? undefined });
}

// ponytail: the test's own list wins whole (Xray Editor §7), else the project's; ids whose folder is gone drop out
export function effectiveContexts(project: string, testId?: string): string[] {
  const own = testId ? readTestContexts(project, testId) : null;
  const ids = own ?? readProject(project).claude.contexts;
  return ids.filter((id) => /^[\w-]+$/.test(id) && existsSync(contextDir(project, id)));
}

function readDocContexts(project: string, docId: string): string[] | null {
  const c = findDoc(project, docId)?.contexts;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string" && /^[\w-]+$/.test(x)) : null;
}

export function writeDocContexts(project: string, docId: string, ids: string[]): void {
  writeDoc(project, { ...readDoc(project, docId), contexts: [...new Set(ids)] });
}

// ponytail: like a test, a document's own list wins whole, else the project's; a run may add its own on top
export function docContexts(project: string, docId: string, run: JobRun = {}): string[] {
  const ids = [...(readDocContexts(project, docId) ?? readProject(project).claude.contexts), ...(run.contexts ?? [])];
  return [...new Set(ids)].filter((id) => /^[\w-]+$/.test(id) && existsSync(contextDir(project, id)));
}

// ponytail: a request on the whole project reads every context the project or one of its tests attaches, each once
export function projectContexts(project: string): string[] {
  const dir = join(project, "tests");
  const tests = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
  const ids = [...readProject(project).claude.contexts, ...tests.flatMap((t) => readTestContexts(project, t) ?? [])];
  return [...new Set(ids)].filter((id) => /^[\w-]+$/.test(id) && existsSync(contextDir(project, id)));
}

export type ContextFile = { name: string; paths: string[]; notes: string };

const bare = (v: string) => {
  const t = v.trim();
  if (!t.startsWith('"')) return t;
  try {
    return String(JSON.parse(t));
  } catch {
    return t.slice(1, t.endsWith('"') ? -1 : undefined);
  }
};
const line = (v: string) => (/^\s|\s$|^"|[\r\n]/.test(v) ? JSON.stringify(v) : v);

// ponytail: contexts/<id>/context.md — the frontmatter says what the context is (name, the outside paths Claude may
// read in place), the body is its notes; the same convention as test.md, readable and editable by hand
export function readContextFile(dir: string): ContextFile {
  const file = join(dir, "context.md");
  const text = existsSync(file) ? readFileSync(file, "utf8").replace(/^\uFEFF/, "") : "";
  const m = text.match(/^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { name: "", paths: [], notes: text };
  let name = "";
  const paths: string[] = [];
  let inPaths = false;
  for (const l of m[1].split(/\r?\n/)) {
    const key = l.match(/^(\w+):\s*(.*)$/);
    if (key) {
      inPaths = key[1] === "paths";
      if (key[1] === "name") name = bare(key[2]);
      continue;
    }
    const item = l.match(/^\s*-\s*(.*)$/);
    if (inPaths && item && bare(item[1])) paths.push(bare(item[1]));
  }
  return { name, paths, notes: text.slice(m[0].length) };
}

export function writeContextFile(dir: string, c: ContextFile): void {
  const head = ["---", `name: ${line(c.name)}`, "paths:", ...c.paths.map((p) => `  - ${line(p)}`), "---", ""];
  writeAtomic(join(dir, "context.md"), `${head.join("\n")}${c.notes}`);
}

export function readContexts(project: string, ids: string[]): Context[] {
  const out: Context[] = [];
  for (const id of ids) {
    if (!/^[\w-]+$/.test(id)) continue;
    const dir = contextDir(project, id);
    if (!existsSync(dir)) continue;
    const c = readContextFile(dir);
    const files = join(dir, "files");
    out.push({
      id,
      name: c.name || id,
      text: c.notes,
      paths: c.paths,
      files: existsSync(files) ? readdirSync(files) : [],
    });
  }
  return out;
}

const slash = (p: string) => p.replace(/\\/g, "/");

export const EDIT_MARKER = "Use the edit-test skill for the request below.";

export function scopeLines(scope: ClaudeScope): string[] {
  if (scope.kind === "project")
    return [
      "Scope: the whole project — every test and every document.",
      "Files: all tests/*/test.md; the documents through rag_search, rag_passage and docs/*/doc.md (read only)",
    ];
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
  conversation = "",
): string {
  const lines = [...scopeLines(scope), "Only modify what the scope allows."];
  if (scope.kind === "step")
    lines.push(
      `Only edit "## Step ${scope.step}" of that file (its fields and its ### Sources); do not touch other steps.`,
    );
  if (scope.kind === "project")
    lines.push(
      "When the request is a question, answer it from the documents and the tests and change nothing; " +
        'put the source of every factual sentence at its end: [<docId>#<anchor> "<exact quote from doc.md>"].',
    );
  lines.push(
    "Follow the test.md format of CLAUDE.md exactly. Every claim keeps or gets its source line: " +
      '`<docId>#<anchor> "<exact quote from doc.md>"` — use rag_search and rag_passage to find them.',
    "The screenshots listed under ### Attachments are files in tests/<id>/images/ — open them with Read when what the screen shows matters.",
  );
  lines.push(...contextLines(project, contexts, note, conversation));
  const req = request.trim();
  if (req) lines.push("", req);
  lines.push(
    "",
    scope.kind === "project"
      ? "When finished, give the answer, or reply in 2-4 lines: what you changed (which tests and steps) and anything you could not do."
      : "When finished, reply in 2-4 lines: what you changed (which steps) and anything you could not do.",
  );
  return `${lines.join("\n")}\n`;
}

// ponytail: the saved contexts are pointed at (Claude reads their files), the note of this run is said in full
export function contextLines(project: string, contexts: Context[], note = "", conversation = ""): string[] {
  const lines: string[] = [];
  if (contexts.length) {
    lines.push("", "Context to read before you start (reference material, do not edit it):");
    for (const c of contexts) {
      const dir = slash(contextDir(project, c.id));
      const parts: string[] = [];
      if (c.text.trim()) parts.push(`notes: ${dir}/context.md`);
      if (c.files.length) parts.push(`files: ${c.files.map((f) => `${dir}/files/${f}`).join(", ")}`);
      if (c.paths.length) parts.push(`also look at: ${c.paths.join(", ")}`);
      lines.push(`- ${c.name}${parts.length ? ` — ${parts.join("; ")}` : ""}`);
    }
  }
  if (note.trim()) lines.push("", "Additional context from the user for this run:", note.trim());
  if (conversation.trim())
    lines.push(
      "",
      "Earlier in this conversation (background: what was asked and answered before; the request below is what to do now):",
      conversation.trim(),
    );
  return lines;
}

// ponytail: a document's own Claude runs (figures, headers, triage) hear what the team knows about it — its note and
// its contexts — then what the user added for this run
export function docRunLines(project: string, docId: string, run: JobRun = {}): string[] {
  const team = readContext(project, docId).trim();
  return [
    ...(team ? ["", "What the team knows about this document:", team] : []),
    ...contextLines(project, readContexts(project, docContexts(project, docId, run)), run.note),
  ];
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
