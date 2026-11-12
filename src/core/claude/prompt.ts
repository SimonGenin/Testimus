import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { readDoc, writeDoc } from "../lib/docs.ts";
import { readLocal, testDir, writeLocal } from "../lib/store.ts";
import type { ChatProblem, ClaudeRun, ClaudeScope, Context } from "../types.ts";
import type { RunKind } from "./access.ts";
import { languageName } from "./language.ts";

/** what a job on a document passes to its Claude runs: the model and effort, a note, contexts on top of the
 * document's own, and what is left out of the run */
export type JobRun = ClaudeRun & { note?: string; contexts?: string[]; without?: string[] };

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

export function writeDocContexts(project: string, docId: string, ids: string[]): void {
  writeDoc(project, { ...readDoc(project, docId), contexts: [...new Set(ids)] });
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

export const EDIT_MARKER = "Use the edit-test skill for the request below.";

// ponytail: a template names its step {step}
type ShownScope = ClaudeScope | { kind: "step"; testId: string; step: string };

export function scopeLines(scope: ShownScope): string[] {
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
  if (scope.kind === "run") {
    const dir = `test-runs/${scope.run}`;
    const what = scope.testId
      ? `${scope.step ? `step ${scope.step} of ` : ""}the test ${scope.testId} of the test run ${scope.run}`
      : `the test run ${scope.run}`;
    return [
      `Scope: ${what} — read only.`,
      `Files: ${dir}/run.json (the tests as frozen when the run was made), ${dir}/results/${scope.testId ?? "<testId>"}.json (OK / NOK per step with what happened, the result, comments and questions) and the screenshots in ${dir}/results/${scope.testId ?? "<testId>"}/ — open them with Read; runs_show and runs_history read the same.`,
    ];
  }
  return [`Scope: step ${scope.step} of test ${scope.testId}.`, `Files: tests/${scope.testId}/test.md`];
}

export function scopedPrompt(scope: ShownScope, request: string, context: string[]): string {
  if (scope.kind === "run") return runPrompt(scope, request, context);
  const lines = [...scopeLines(scope), "Change nothing outside the scope."];
  if (scope.kind === "step") lines.push(`Only "## Step ${scope.step}" of that file: its columns and its ### Sources.`);
  if (scope.kind === "project")
    lines.push(
      'A question is answered from the documents and the tests, changing nothing, each factual sentence ending with its source: [<docId>#<anchor> "<exact quote from doc.md>"]. A request that changes tests follows the edit-test skill.',
    );
  lines.push(
    "The pictures under ### Attachments are files of tests/<id>/images/: Read one when what the screen shows matters.",
  );
  lines.push(...context);
  const req = request.trim();
  if (req) lines.push("", req);
  lines.push(
    "",
    scope.kind === "project"
      ? "Reply with the answer, or in 2 to 4 lines: what changed (which tests and steps) and what you could not do."
      : "Reply in 2 to 4 lines: what changed (which steps) and what you could not do.",
  );
  return `${lines.join("\n")}\n`;
}

// ponytail: a run is the testers' — Claude reads it and answers; a note, a comment or a bug it is asked for is written
// out in the answer for the tester to take, never into the run (its writes are refused to every Claude run)
function runPrompt(scope: Extract<ClaudeScope, { kind: "run" }>, request: string, context: string[]): string {
  const lines = [
    ...scopeLines(scope),
    "Change no file: a test run is the testers' — you read it, you never mark a step or a result.",
    "A note on what happened, a comment, an answer to a question or a bug report the request asks for is written out in the answer, in the project's language, the text to paste alone in one fenced block (```text … ```).",
    'Say whether what the tester saw contradicts the documents or the test itself; a factual sentence from a document ends with its source: [<docId>#<anchor> "<exact quote from doc.md>"].',
    ...context,
  ];
  const req = request.trim();
  if (req) lines.push("", req);
  lines.push("", "Reply with the answer.");
  return `${lines.join("\n")}\n`;
}

// ponytail: a prompt Testimus builds, as Settings › Context shows it — the very builder a run calls, given the parts
// filled per run as {placeholders}; every module that runs claude -p exports its own (tests/unit/core/claude/catalog)
export type PromptTemplate = {
  id: string;
  name: string;
  group: string;
  /** the kind of run that sends it: it decides the tools the run has and what goes with it (claude/given.ts); a
   * sign-in probe has none */
  kind?: RunKind;
  usedBy: string[];
  /** what the run gives back, and through what */
  answers: string;
  text: () => string;
};

// ponytail: a problem the app met is about the app, the machine or the network, not the specification — Claude may
// use what it knows, looks without changing anything, and leaves a button behind only when the app's commands can fix it
export function problemPrompt(
  question: string,
  problem: ChatProblem,
  language: string,
  propose: string[],
  context: string[] = [],
): string {
  return [
    "Testimus met the problem below. Explain plainly what most likely causes it and what the user can do about it.",
    "It is about the app, the machine, the network or an account, not the specification: you may use what you know.",
    "Look first when it helps — the project files and the app's tools, read only; change nothing now.",
    "When only the user can fix it (a setting, a certificate, the network, an account), give the steps, the most likely first.",
    "",
    `Problem (${problem.where}): ${problem.text.trim()}`,
    ...propose,
    `Answer in the language of the question (the project's is ${languageName(language)}).`,
    ...context,
    "",
    `Question: ${question.trim()}`,
    "",
  ].join("\n");
}

// ponytail: the chat writes no file, and the files the user may ask it to correct are closed to every run — it proposes,
// the user applies (lib/proposals.ts)
export function proposeChangeLines(runId: string): string[] {
  const id = `runId: "${runId}"`;
  return [
    `A change the user asks to the overview of how the documents fit together, to a saved context or to a smart column's description is never written by you: propose it with docs_overviewPropose { ${id}, text, why }, contexts_propose { ${id}, id, notes, why } or columns_propose { ${id}, column, description, why }.`,
    "Give the whole new text: the current one (read it first) changed only where the user asked. The user sees it as a diff under your answer and applies it or not; say in one sentence what you proposed.",
  ];
}

export function chatPrompt(question: string, language: string, context: string[] = [], runId = "{runId}"): string {
  return [
    "Use the ask-docs skill to answer the question below from the project's documents, and only from them.",
    `Answer in the language of the question (the project's is ${languageName(language)}).`,
    ...proposeChangeLines(runId),
    ...context,
    "",
    `Question: ${question.trim()}`,
    "",
  ].join("\n");
}
