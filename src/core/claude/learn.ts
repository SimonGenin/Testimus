import { CONVERSATIONS, CONVERSATIONS_FILE, LEARN_MAX } from "../lib/contexts.ts";
import { readProject } from "../lib/project.ts";
import type { ChatSession, ClaudeEvent, Diagnosis, Effort } from "../types.ts";
import { showChat } from "./chat.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import { type PromptTemplate, readContexts } from "./prompt.ts";
import { runClaude } from "./run.ts";
import { readRun } from "./snapshot.ts";

export const LEARN_MARKER = "Keep what the last exchange with Claude taught about this project";
export const LEARN_MODEL = "sonnet";
export const LEARN_EFFORT: Effort = "low";

// ponytail: an answer can be long — what lasts from it is in its first few thousand characters, and the run is a cheap one
const EXCHANGE_MAX = 6000;

const cut = (s: string) => (s.length > EXCHANGE_MAX ? `${s.slice(0, EXCHANGE_MAX)}…` : s);

// ponytail: the last question and the answer that followed it — what this run learns from, never the whole conversation
export function lastExchange(chat: ChatSession): { question: string; answer: string } | null {
  for (let i = chat.turns.length - 1; i > 0; i--)
    if (chat.turns[i].role === "assistant" && chat.turns[i - 1].role === "user")
      return { question: chat.turns[i - 1].text, answer: chat.turns[i].text };
  return null;
}

export function learnPrompt(
  current: string,
  exchange: { question: string; answer: string },
  language: string,
  context: string[] = [],
): string {
  return [
    `${LEARN_MARKER}. The saved context « Conversations » (${CONVERSATIONS_FILE}) is given to every Claude run of the project: it holds what the team settled while talking with Claude.`,
    "Rewrite it with what the exchange below adds, and save the whole new text with contexts_learn { text }, once. Change nothing else; do not search the documents.",
    "",
    "Rules:",
    "- Keep only what will help another run: decisions the team took, how they want tests written, corrections they repeat, their words for things, questions settled.",
    "- Never copy a passage, a quote or a source of the documents (docId#anchor): the runs read the documents themselves.",
    "- A point the exchange contradicts is replaced, never kept beside the new one.",
    "- No dates, no log of what was asked: what holds now, in short lines under a few headings.",
    `- At most ${LEARN_MAX} characters: condense as it grows; contexts_learn refuses a longer text.`,
    "- When the exchange teaches nothing that lasts, do not call contexts_learn.",
    `- Write it in ${languageName(language)}.`,
    ...context,
    "",
    "The context today:",
    current.trim() || "(empty: this is its first lesson)",
    "",
    "The last exchange:",
    `User: ${cut(exchange.question.trim())}`,
    `Claude: ${cut(exchange.answer.trim())}`,
    "",
    "Reply in one line: what you kept, or « Nothing to keep ».",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "learn",
    name: "Remember what a conversation taught",
    group: "Chat",
    kind: "learn",
    usedBy: ["After each answer of the Claude tab's chat, unless « Don't remember this conversation »", "chat.learn"],
    answers: `The whole new text of ${CONVERSATIONS_FILE}, through contexts_learn`,
    text: () =>
      learnPrompt("{the context today}", { question: "{question}", answer: "{answer}" }, "{language}", GIVEN_SLOT),
  },
];

export type LearnOpts = {
  project: string;
  chatId: string;
  model?: string;
  effort?: Effort;
  contexts?: string[];
  without?: string[];
  signal?: AbortSignal;
  jobId?: string;
  onEvent?(e: ClaudeEvent): void;
};

export type LearnResult = {
  ok: boolean;
  learned: boolean;
  summary: string;
  runId?: string;
  costUsd?: number;
  diagnosis?: Diagnosis;
};

export async function learn(o: LearnOpts): Promise<LearnResult> {
  const exchange = lastExchange(showChat(o.project, o.chatId));
  if (!exchange) return { ok: true, learned: false, summary: "The conversation has no answer yet." };
  const [now] = readContexts(o.project, [CONVERSATIONS]);
  const current = now?.text ?? "";
  // ponytail: the context the run rewrites is in its prompt as the thing to rewrite, never again as reference
  const g = given(
    o.project,
    "learn",
    { kind: "none" },
    { contexts: o.contexts, without: [...(o.without ?? []), `context:${CONVERSATIONS}`] },
  );
  const res = await runClaude({
    project: o.project,
    kind: "learn",
    prompt: learnPrompt(current, exchange, readProject(o.project).language, g.lines),
    model: o.model || LEARN_MODEL,
    effort: o.effort || LEARN_EFFORT,
    scope: { kind: "tests", testIds: [] },
    files: [CONVERSATIONS_FILE],
    given: g,
    label: "learn",
    signal: o.signal,
    jobId: o.jobId,
    onEvent: o.onEvent,
  });
  const learned = !!readRun(o.project, res.runId).changedFiles?.includes(CONVERSATIONS_FILE);
  return {
    ok: res.ok,
    learned,
    summary: res.summary,
    runId: res.runId,
    costUsd: res.costUsd,
    diagnosis: res.diagnosis,
  };
}
