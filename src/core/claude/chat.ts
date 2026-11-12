import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { generationName } from "../lib/names.ts";
import { readJson, readProject, writeJson } from "../lib/project.ts";
import { proposalsOf } from "../lib/proposals.ts";
import type { ChatProblem, ChatSession, ClaudeEvent, Diagnosis, Effort, Proposal, Source, Tokens } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { planText, settledLines } from "./gen-plan.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { readLedger } from "./ledger.ts";
import { chatPrompt, type PromptTemplate, problemPrompt } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";

const chatsDir = (project: string) => join(project, ".testimus", "chats");
const chatFile = (project: string, id: string) => join(chatsDir(project), `${id}.json`);

const REF =
  /([A-Za-z0-9][\w.-]*)#((?:§|fig:|page:|img:|t:|frame:)[^\s"“”«»\]]+)\s*[:,]?\s*(?:"([^"\n]+)"|“([^”\n]+)”|«\s*([^»\n]+?)\s*»)/g;

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

// ponytail: the plan Generate shows while it waits for the user's go — the chat has it, may answer its questions in
// words, and proposes a new plan (gen.planPropose) the user applies; it never writes it
export function planLines(project: string, generation: string, runId: string): string[] {
  const l = readLedger(project, generation);
  if (l?.state !== "planned" || !l.plan) return [];
  return [
    "",
    `The user is reviewing on Generate the plan of « ${generationName(project, generation)} » (generation ${generation}) before any test is written:`,
    planText(l.plan),
    ...(l.settled?.length ? ["Questions the user settled:", ...settledLines(l.settled)] : []),
    `A change to this plan is never written by you: propose it with gen_planPropose { runId: "${runId}", generation: "${generation}", plan: { tests: [{ summary, technique, sections, theme, off? }], questions? }, why } — the whole plan, the current one changed only where the user asked. The user records the answers to its questions on Generate.`,
    "",
  ];
}

const PROBLEM_EXAMPLES =
  "« Index the documents again » when the index is missing or stale, « Convert the document again » when a conversion failed";

export const prompts: PromptTemplate[] = [
  {
    id: "chat",
    name: "Ask about the documents",
    group: "Chat",
    kind: "chat",
    usedBy: ["Claude tab: Ask", "chat.ask"],
    answers: "An answer, each factual sentence with its source",
    text: () => chatPrompt("{question}", "{language}", GIVEN_SLOT),
  },
  {
    id: "chat-problem",
    name: "Ask about a problem the app met",
    group: "Chat",
    kind: "triage",
    usedBy: ["Ask Claude about a problem: a failed job, a warning", "chat.ask"],
    answers: "An explanation and what to do; actions_propose when the app's commands can fix it",
    text: () =>
      problemPrompt(
        "{question}",
        { where: "{where}", text: "{problem}" },
        "{language}",
        proposeLines("{runId}", PROBLEM_EXAMPLES),
        GIVEN_SLOT,
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
  without?: string[];
  note?: string;
  conversation?: string;
  /** a problem the app met: the conversation is about it, not the documents */
  problem?: ChatProblem;
  /** a generation whose plan waits on Generate: the chat has it and may propose a new one */
  generation?: string;
  signal?: AbortSignal;
  onEvent?(e: ClaudeEvent): void;
};

export type AskResult = {
  chatId: string;
  sessionId?: string;
  ok: boolean;
  answer: string;
  sources: Source[];
  /** the changes the answer proposes, each applied or ignored by the user */
  proposals: Proposal[];
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
  // ponytail: a problem is looked at like a triage — read only, and it may leave an action card behind
  const runId = newRunId();
  const problem = chat.problem;
  const kind = problem ? "triage" : "chat";
  const g = given(o.project, kind, { kind: "none" }, o);
  const run = (resume?: string) =>
    runClaude({
      project: o.project,
      prompt: problem
        ? problemPrompt(o.question, problem, p.language, proposeLines(runId, PROBLEM_EXAMPLES), g.lines)
        : chatPrompt(
            o.question,
            p.language,
            g.lines,
            runId,
            o.generation ? planLines(o.project, o.generation, runId) : [],
          ),
      model: o.model || p.claude.model,
      effort: o.effort || p.claude.effort,
      kind,
      runId,
      ...(problem ? { label: "ask" } : {}),
      given: g,
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
  if (res.ok) chat.turns.push({ role: "assistant", text: answer, at: now(), runId });
  chat.updatedAt = now();
  writeJson(chatFile(o.project, chat.id), chat);
  return {
    chatId: chat.id,
    sessionId: chat.sessionId,
    ok: res.ok,
    answer: res.ok ? answer : res.summary,
    sources: res.ok ? sourceRefs(answer) : [],
    proposals: res.ok ? proposalsOf(o.project, [runId]) : [],
    costUsd: res.costUsd,
    tokens: res.tokens,
    diagnosis: res.diagnosis,
    raw: res.raw,
  };
}
