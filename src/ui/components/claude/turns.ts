import type {
  ChatProblem,
  ClaudeAction,
  ClaudeResult,
  ClaudeScope,
  Diagnosis,
  Effort,
  Source,
  Tokens,
} from "../../../core/types.ts";
import { plural } from "../../lib/format.ts";
import type { BadgeTone } from "../ui/Badge.tsx";
import type { IconName } from "../ui/Icon.tsx";

export type Mode = "docs" | "test";

export type Meta = { durationMs: number; tokens?: Tokens; sessionId?: string; model: string; effort: Effort };

// what a failed request needs to be sent again (Retry)
export type Again = {
  mode: Mode;
  text: string;
  scope?: ClaudeScope;
  contexts?: string[];
  note?: string;
  label?: string;
  model: string;
  effort: Effort;
  /** a problem the app met: Claude is asked about it, in a conversation of its own */
  problem?: ChatProblem;
};

export type RunCard = {
  runId: string;
  testId: string;
  docId?: string;
  steps: number;
  tests: number;
  files?: number;
  reverted?: boolean;
  review?: string;
  /** why the fix's re-check did not finish */
  message?: string;
  /** a review.fix run: its changes are shown in Review */
  fix?: boolean;
};

// one thing Claude did in a turn: what it says, whether it is over, when (ms), the skill it opened
export type Tool = { label: string; done: boolean; at?: number; skill?: string };

export type Turn = {
  id: number;
  role: "user" | "assistant";
  kind?: "run" | "chat";
  text: string;
  tools: Tool[];
  /** when the request was sent (ms): the steps' times count from it */
  startedAt?: number;
  running?: boolean;
  label?: string;
  testId?: string;
  sources?: Source[];
  trouble?: Diagnosis | { title: string; detail: string };
  run?: RunCard;
  note?: string;
  meta?: Meta;
  raw?: string;
  showRaw?: boolean;
  again?: Again;
  action?: ClaudeAction;
  /** an answer about one step of a test run: its pasted block may become the step's note */
  pasteTo?: { run: string; testId: string; step: number };
};

// ponytail: the text Claude put alone to be pasted — the last fenced block of its answer (the run prompt asks for one)
export function pasteOf(text: string): string {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() : "";
}

export type RunResult = ClaudeResult & {
  runId?: string;
  changedSteps?: Record<string, number[]> | number[];
  changedFiles?: string[];
  review?: string;
  message?: string;
  action?: ClaudeAction;
};

export type ChatResult = {
  chatId: string;
  ok?: boolean;
  answer: string;
  sources?: Source[];
  diagnosis?: Diagnosis;
  tokens?: Tokens;
  sessionId?: string;
  raw?: string;
};

// ponytail: a run with no test (the whole project) still marks Claude as running, so every editor locks
export const PROJECT_RUN = "*project*";

// ponytail: what a run locks — the test it edits, every test (the project), or nothing: on a test run Claude only
// reads, so its lock names the run and matches no test
export function lockOf(scope: ClaudeScope | undefined): string | undefined {
  if (scope?.kind === "step" || scope?.kind === "test") return scope.testId;
  if (scope?.kind === "run") return `run:${scope.run}`;
  return undefined;
}

// ponytail: the one reading of the lock — Claude works on this test when its run names it or the whole project
export const claudeOn = (claudeRunning: string | null, testId: string | null | undefined): boolean =>
  !!testId && (claudeRunning === testId || claudeRunning === PROJECT_RUN);

// ponytail: review.fix re-checks in the same job — the fixed test goes back to Draft for review; the word says
// whether its re-check finished, and why not
export function fixOutcome(r: { review?: string; message?: string }): { word: string; note?: string } {
  if (!r.review) return { word: "check queued" };
  if (r.message) return { word: "re-check incomplete", note: r.message };
  return { word: "back to review" };
}

export const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function metaLine(m: Meta): string {
  return [
    `${(m.durationMs / 1000).toFixed(1)} s`,
    m.tokens ? `${kilo(m.tokens.input)} tokens in · ${kilo(m.tokens.output)} out` : "no tokens reported",
    `${m.model || "default"} / ${m.effort}`,
    m.sessionId ? `session ${m.sessionId.slice(0, 8)}…` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ponytail: the Testimus commands Claude calls most, said as what they do (« Used docs.list » said nothing)
const SAID: Record<string, string> = {
  "docs.list": "Listed the documents",
  "tests.list": "Listed the existing tests",
  "columns.list": "Listed the columns",
  "contexts.list": "Read the saved contexts",
  "project.info": "Read the project settings",
  "xray.folders": "Looked up the Xray folders",
  "check.run": "Ran the check",
  "check.show": "Read the check",
};

const tail = (p: string) => p.split(/[\\/]/).slice(-2).join("/");

export function toolLabel(name: string, input: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(input) as Record<string, unknown>;
  } catch {}
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  const short = name.replace(/^mcp__testimus__/, "").replace(/_/g, ".");
  const q = str("query") || str("question");
  if (name === "Skill") return str("skill") ? `Opened the ${str("skill")} skill` : "Opened a skill";
  if (/search/i.test(short) && q) return `Searched the documents for “${q}”`;
  if (/passage/i.test(short) && str("docId")) return `Read ${str("docId")} ${str("anchor")}`;
  if (SAID[short]) return SAID[short];
  if (short === "tests.save") return str("id") ? `Wrote the steps of ${str("id")}` : "Wrote the steps of a test";
  if (short === "tests.show" && str("id")) return `Opened ${str("id")}`;
  if (short === "docs.show" && str("id")) return `Looked up ${str("id")}`;
  const path = str("file_path");
  const doc = path.match(/docs[\\/]+([^\\/]+)[\\/]+doc\.md$/)?.[1];
  if (name === "Read" && doc) return `Read ${doc}`;
  if (name === "Read") return `Read ${tail(path)}`.trim();
  if (name === "Grep") return str("pattern") ? `Searched the files for “${str("pattern")}”` : "Searched the files";
  if (name === "Glob") return `Listed ${str("pattern")}`.trim();
  if (/^(Edit|Write|MultiEdit)$/.test(name)) return `Edited ${path ? tail(path) : "a file"}`;
  return `Used ${short}`;
}

// the skill a tool call opened, if it is one
export const skillOf = (name: string, input: string): string | undefined => {
  if (name !== "Skill") return undefined;
  try {
    const s = (JSON.parse(input) as { skill?: unknown }).skill;
    return typeof s === "string" && s ? s : undefined;
  } catch {
    return input.match(/"skill"\s*:\s*"([^"]+)"/)?.[1];
  }
};

// ponytail: what the panel shows until Clear goes with every request, as a transcript Claude reads as background;
// the chat turns are left out when the documents conversation resumes, its session has them already
export function transcript(turns: Turn[], skipChat = false): string {
  const said = (t: Turn): string => {
    if (t.role === "user")
      return `User${t.label ? ` (${t.label})` : ""}: ${t.text.trim() || "(no words: work from the scope and the house rules)"}`;
    const head = t.action ? `Claude (action « ${t.action.title} »)` : "Claude";
    const done = t.run
      ? t.run.reverted
        ? "(the user reverted these changes)"
        : `(${plural(t.run.steps, "step")} changed${t.run.tests > 1 ? ` in ${t.run.tests} tests` : ""}${t.run.files ? `, ${plural(t.run.files, "file")}` : ""})`
      : "";
    const text = [t.text.trim() || t.trouble?.title || "", done].filter(Boolean).join(" ");
    return text ? `${head}: ${text}` : "";
  };
  return turns
    .filter((t) => !t.running && !(skipChat && t.kind === "chat"))
    .map(said)
    .filter(Boolean)
    .join("\n\n")
    .slice(-60000);
}

export const docOfRoute = (r: { screen: string; arg?: string }): string | null =>
  r.screen === "documents" && r.arg ? r.arg.split("#")[0] || null : null;

export const changed = (run: RunCard) => run.steps > 0 || (run.files ?? 0) > 0;

export type RunBadge = { label: string; tone: BadgeTone; icon: IconName };

const OUTCOME: Record<string, Omit<RunBadge, "label">> = {
  "check queued": { tone: "info", icon: "clock" },
  "back to review": { tone: "success", icon: "check-circle" },
  "re-check incomplete": { tone: "warning", icon: "to-fix" },
};

// the run card's badges: what changed, then what became of the test's check — or that it was reverted
export function runBadges(run: RunCard, action: boolean): RunBadge[] {
  if (run.reverted) return [{ label: "Reverted", tone: "neutral", icon: "undo" }];
  if (action) {
    const what = [run.files ? plural(run.files, "file") : "", run.steps ? plural(run.steps, "step") : ""]
      .filter(Boolean)
      .join(" and ");
    return [
      what
        ? { label: `${what} changed`, tone: "claude", icon: "claude" }
        : { label: "Nothing changed", tone: "neutral", icon: "check" },
    ];
  }
  const word = fixOutcome(run).word;
  return [
    {
      label: `${plural(run.steps, "step")} changed${run.tests > 1 ? ` in ${run.tests} tests` : ""}`,
      tone: "claude",
      icon: "claude",
    },
    { label: word[0].toUpperCase() + word.slice(1), ...OUTCOME[word] },
  ];
}

// a run's changed steps, as one list per test (a run on one test may report a bare list)
export function changedOf(r: RunResult, testId: string): Record<string, number[]> {
  if (!Array.isArray(r.changedSteps)) return r.changedSteps ?? {};
  return r.changedSteps.length ? { [testId]: r.changedSteps } : {};
}
