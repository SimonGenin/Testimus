import type { Ctx } from "../command.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeScope, Effort } from "../types.ts";
import { GIVEN_SLOT, given, subjectOf } from "./given.ts";
import { EDIT_MARKER, type PromptTemplate, scopedPrompt } from "./prompt.ts";
import { runClaude } from "./run.ts";

export type ScopedInput = {
  scope: ClaudeScope;
  prompt: string;
  model?: string;
  effort?: Effort;
  contexts?: string[];
  without?: string[];
  note?: string;
  conversation?: string;
};

// ponytail: a request on tests goes through the edit-test skill; one on the project may be a question, answered as is
const sent = (scope: Parameters<typeof scopedPrompt>[0], request: string, context: string[]) => {
  const prompt = scopedPrompt(scope, request, context);
  return scope.kind === "project" || scope.kind === "run" ? prompt : `${EDIT_MARKER}\n${prompt}`;
};

export const scopedKind = (scope: ClaudeScope) => (scope.kind === "run" ? "chat" : "run");

export async function runOnScope(ctx: Ctx, project: string, input: ScopedInput) {
  const p = readProject(project);
  const kind = scopedKind(input.scope);
  const g = given(project, kind, subjectOf(input.scope), input);
  const { calls: _calls, ...r } = await runClaude({
    kind,
    project,
    prompt: sent(input.scope, input.prompt, g.lines),
    model: input.model || p.claude.model,
    effort: input.effort || p.claude.effort,
    scope: input.scope,
    given: g,
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  return r;
}

const USED = "claude.run";
const CHANGED = "The tests it changed (snapshotted: Revert puts them back) and a few lines saying what changed";

export const prompts: PromptTemplate[] = [
  {
    id: "ask-step",
    name: "Ask Claude on a step",
    group: "Tests",
    kind: "run",
    usedBy: ["Claude tab on a step", USED],
    answers: CHANGED,
    text: () => sent({ kind: "step", testId: "{test}", step: "{step}" }, "{request}", GIVEN_SLOT),
  },
  {
    id: "ask-test",
    name: "Ask Claude on a test",
    group: "Tests",
    kind: "run",
    usedBy: ["Claude tab on a test", "Quick asks", USED],
    answers: CHANGED,
    text: () => sent({ kind: "test", testId: "{test}" }, "{request}", GIVEN_SLOT),
  },
  {
    id: "ask-tests",
    name: "Ask Claude on several tests",
    group: "Tests",
    kind: "run",
    usedBy: ["Claude tab on several tests", "Generate › Ask for changes", "gen.revise (change)", USED],
    answers: CHANGED,
    text: () => sent({ kind: "tests", testIds: ["{test}", "{other test}"] }, "{request}", GIVEN_SLOT),
  },
  {
    id: "ask-doc",
    name: "Ask Claude on a document",
    group: "Documents",
    kind: "run",
    usedBy: ["Claude tab on a document", "Claude actions on a document", USED],
    answers: CHANGED,
    text: () => sent({ kind: "doc", docId: "{document}" }, "{request}", GIVEN_SLOT),
  },
  {
    id: "ask-project",
    name: "Ask Claude on the project",
    group: "Tests",
    kind: "run",
    usedBy: ["Claude tab on the project", USED],
    answers: "An answer with its sources, or the tests it changed and what changed",
    text: () => sent({ kind: "project" }, "{request}", GIVEN_SLOT),
  },
  {
    id: "ask-run",
    name: "Ask Claude on a test run",
    group: "Tests",
    kind: "chat",
    usedBy: ["Claude tab on a test run", USED],
    answers: "An answer; a note or a comment to paste comes in a fenced block. Nothing is written",
    text: () => sent({ kind: "run", run: "{run}", testId: "{test}" }, "{request}", GIVEN_SLOT),
  },
];
