import { MENTION } from "../lib/adf.ts";
import { readProject } from "../lib/project.ts";
import { testExists } from "../lib/store.ts";
import type { ClaudeEvent, Diagnosis, Effort, Tokens } from "../types.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import type { PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

// ponytail: Claude drafts a comment for a test's Jira issue and gives it back as text — it never posts one (issue.*
// writes are out of its reach); the person reads it in the composer and sends it, or not

export type DraftOpts = {
  project: string;
  key: string;
  ask?: string;
  model?: string;
  effort?: Effort;
  contexts?: string[];
  without?: string[];
  signal?: AbortSignal;
  onEvent?(e: ClaudeEvent): void;
};

export type Draft = {
  ok: boolean;
  text: string;
  mentions: { accountId: string; name: string }[];
  costUsd?: number;
  tokens?: Tokens;
  diagnosis?: Diagnosis;
  raw?: string;
};

export function draftPrompt(key: string, ask: string, language: string, context: string[] = []): string {
  return [
    `Use the draft-comment skill to draft a comment for the Jira issue ${key}, the test in tests/${key}/test.md.`,
    "Reply with the comment's text only: no preamble, no quotes around it, no signature.",
    `Write in the language of the thread (the project's is ${languageName(language)}).`,
    ...context,
    "",
    ask.trim() ? `What the comment should say: ${ask.trim()}` : "What the comment should say: answer the thread.",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "comment",
    name: "Draft a Jira comment",
    group: "Jira",
    kind: "chat",
    usedBy: ["Tests › Jira comments: Draft with Claude", "claude.draftComment"],
    answers: "The comment's text only; the person reads it and sends it",
    text: () => draftPrompt("{issue key}", "{request}", "{language}", GIVEN_SLOT),
  },
];

export async function draftComment(o: DraftOpts): Promise<Draft> {
  const p = readProject(o.project);
  const g = given(
    o.project,
    "chat",
    testExists(o.project, o.key) ? { kind: "test", testId: o.key } : { kind: "none" },
    o,
  );
  const res = await runClaude({
    project: o.project,
    prompt: draftPrompt(o.key, o.ask ?? "", p.language, g.lines),
    model: o.model || p.claude.model,
    effort: o.effort || p.claude.effort,
    kind: "chat",
    label: "comment draft",
    given: g,
    signal: o.signal,
    onEvent: o.onEvent,
  });
  const text = res.ok ? res.summary.trim() : "";
  return {
    ok: res.ok,
    text: res.ok ? text : res.summary,
    mentions: [...text.matchAll(MENTION)].map((m) => ({ accountId: m[2], name: m[1] })),
    costUsd: res.costUsd,
    tokens: res.tokens,
    diagnosis: res.diagnosis,
    raw: res.raw,
  };
}
