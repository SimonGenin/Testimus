import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { readJson, readProject, writeJson } from "../lib/project.ts";
import type { ChatProblem, ChatSession, ClaudeEvent, Diagnosis, Effort, Source, Tokens } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { CONTEXT_SLOT, chatPrompt, contextLines, type PromptTemplate, problemPrompt, readContexts } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";

const chatsDir = (project: string) => join(project, ".testimus", "chats");
const chatFile = (project: string, id: string) => join(chatsDir(project), `${id}.json`);

const REF =
  /([A-Za-z0-9][\w.-]*)#((?:§|fig:|page:)[^\s"“”«»\]]+)\s*[:,]?\s*(?:"([^"\n]+)"|“([^”\n]+)”|«\s*([^»\n]+?)\s*»)/g;

export function sourceRefs(text: string): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REF)) {
    const s = { docId: m[1], anchor: m[2].replace(/[.,;:)]+$/, ""), quote: (m[3] ?? m[4] ?? m[5] ?? "").trim() };
    const k = `${s.docId}#${s.anchor} ${s.quote}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function showChat(project: string, id: string): ChatSession {
  if (!/^[\w-]+$/.test(id) || !existsSync(chatFile(project, id)))
    throw new UserError(`No chat ${id} in this project.`, "chat.list shows the conversations.");
  return readJson<ChatSession>(chatFile(project, id), {} as ChatSession);
}

export function listChats(project: string): { id: string; title: string; updatedAt: string; turns: number }[] {
  const dir = chatsDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<ChatSession | null>(join(dir, f), null))
    .filter((c): c is ChatSession => !!c?.id)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, turns: c.turns.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const PROBLEM_EXAMPLES =
  "« Index the documents again » when the index is missing or stale, « Convert the document again » when a conversion failed";

export const prompts: PromptTemplate[] = [
  {
    id: "chat",
    name: "Ask about the documents",
    group: "Chat",
    usedBy: ["Claude dock: Ask", "chat.ask"],
    text: () => chatPrompt("{question}", "{language}", CONTEXT_SLOT),
  },
  {
    id: "chat-problem",
    name: "Ask about a problem the app met",
    group: "Chat",
    usedBy: ["Ask Claude about a problem: a failed job, a warning", "chat.ask"],
    text: () =>
      problemPrompt(
        "{question}",
        { where: "{where}", text: "{problem}" },
        "{language}",
        proposeLines("{runId}", PROBLEM_EXAMPLES),
        CONTEXT_SLOT,
      ),
  },
];

export type AskOpts = {
  project: string;
  question: string;
  chatId?: string;
  model?: string;
  effort?: Effort;
  contexts?: string[];
  note?: string;
  conversation?: string;
  /** a problem the app met: the conversation is about it, not the documents */
  problem?: ChatProblem;
  signal?: AbortSignal;
  onEvent?(e: ClaudeEvent): void;
};

export type AskResult = {
  chatId: string;
  sessionId?: string;
  ok: boolean;
  answer: string;
  sources: Source[];
  costUsd?: number;
  tokens?: Tokens;
  diagnosis?: Diagnosis;
  raw?: string;
};

export async function ask(o: AskOpts): Promise<AskResult> {
  const p = readProject(o.project);
  const now = () => env.now().toISOString();
  const chat: ChatSession = o.chatId
    ? showChat(o.project, o.chatId)
    : {
        id: `chat-${randomBytes(4).toString("hex")}`,
        title: o.question.trim().replace(/\s+/g, " ").slice(0, 80),
        turns: [],
        updatedAt: now(),
      };
  if (o.problem) chat.problem = { where: o.problem.where.trim(), text: o.problem.text.trim() };
  chat.turns.push({ role: "user", text: o.question.trim(), at: now() });
  const context = contextLines(o.project, readContexts(o.project, o.contexts ?? []), o.note, o.conversation);
  // ponytail: a problem is looked at like a triage — read only, and it may leave an action card behind
  const runId = newRunId();
  const problem = chat.problem;
  const run = (resume?: string) =>
    runClaude({
      project: o.project,
      prompt: problem
        ? problemPrompt(o.question, problem, p.language, proposeLines(runId, PROBLEM_EXAMPLES), context)
        : chatPrompt(o.question, p.language, context),
      model: o.model || p.claude.model,
      effort: o.effort || p.claude.effort,
      kind: problem ? "triage" : "chat",
      ...(problem ? { runId, label: "ask" } : {}),
      contexts: o.contexts,
      resume,
      signal: o.signal,
      onEvent: o.onEvent,
    });
  let res = await run(chat.sessionId);
  // ponytail: a session Claude no longer has (cleared, another PC) restarts the conversation instead of failing
  if (!res.ok && chat.sessionId && !o.signal?.aborted && /no conversation found/i.test(`${res.summary}\n${res.raw}`))
    res = await run();
  if (res.sessionId) chat.sessionId = res.sessionId;
  const answer = res.ok ? res.summary : "";
  if (res.ok) chat.turns.push({ role: "assistant", text: answer, at: now() });
  chat.updatedAt = now();
  writeJson(chatFile(o.project, chat.id), chat);
  return {
    chatId: chat.id,
    sessionId: chat.sessionId,
    ok: res.ok,
    answer: res.ok ? answer : res.summary,
    sources: res.ok ? sourceRefs(answer) : [],
    costUsd: res.costUsd,
    tokens: res.tokens,
    diagnosis: res.diagnosis,
    raw: res.raw,
  };
}
