import type { Ctx } from "../command.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeScope, Effort } from "../types.ts";
import {
  CONTEXT_SLOT,
  contextLines,
  EDIT_MARKER,
  effectiveContexts,
  type PromptTemplate,
  projectContexts,
  readContexts,
  scopedPrompt,
} from "./prompt.ts";
import { runClaude } from "./run.ts";

export type ScopedInput = {
  scope: ClaudeScope;
  prompt: string;
  model?: string;
  effort?: Effort;
  contexts?: string[];
  note?: string;
  conversation?: string;
};

// ponytail: a request on tests goes through the edit-test skill; one on the project may be a question, answered as is
const sent = (scope: Parameters<typeof scopedPrompt>[0], request: string, context: string[]) => {
  const prompt = scopedPrompt(scope, request, context);
  return scope.kind === "project" ? prompt : `${EDIT_MARKER}\n${prompt}`;
};

export async function runOnScope(ctx: Ctx, project: string, input: ScopedInput) {
  const p = readProject(project);
  const ids =
    input.contexts ??
    (input.scope.kind === "project"
      ? projectContexts(project)
      : effectiveContexts(project, "testId" in input.scope ? input.scope.testId : undefined));
  const context = contextLines(project, readContexts(project, ids), input.note, input.conversation);
  const { calls: _calls, ...r } = await runClaude({
    kind: "run",
    project,
    prompt: sent(input.scope, input.prompt, context),
    model: input.model || p.claude.model,
    effort: input.effort || p.claude.effort,
    scope: input.scope,
    contexts: ids,
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  return r;
}

const USED = "claude.run";

export const prompts: PromptTemplate[] = [
  {
    id: "ask-step",
    name: "Ask Claude on a step",
    group: "Tests",
    usedBy: ["Claude dock on a step", USED],
    text: () => sent({ kind: "step", testId: "{test}", step: "{step}" }, "{request}", CONTEXT_SLOT),
  },
  {
    id: "ask-test",
    name: "Ask Claude on a test",
    group: "Tests",
    usedBy: ["Claude dock on a test", "Quick asks", USED],
    text: () => sent({ kind: "test", testId: "{test}" }, "{request}", CONTEXT_SLOT),
  },
  {
    id: "ask-tests",
    name: "Ask Claude on several tests",
    group: "Tests",
    usedBy: ["Claude dock on several tests", "Generate › Ask for changes", "gen.revise (change)", USED],
    text: () => sent({ kind: "tests", testIds: ["{test}", "{other test}"] }, "{request}", CONTEXT_SLOT),
  },
  {
    id: "ask-doc",
    name: "Ask Claude on a document",
    group: "Documents",
    usedBy: ["Claude dock on a document", "Claude actions on a document", USED],
    text: () => sent({ kind: "doc", docId: "{document}" }, "{request}", CONTEXT_SLOT),
  },
  {
    id: "ask-project",
    name: "Ask Claude on the project",
    group: "Tests",
    usedBy: ["Claude dock on the project", USED],
    text: () => sent({ kind: "project" }, "{request}", CONTEXT_SLOT),
  },
];
