import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeOut, ClaudeSpawn } from "../env.ts";

type Script = { match: (prompt: string, args: string[]) => boolean; run: (spawn: ClaudeSpawn) => Promise<ClaudeOut> };

const scripts: Script[] = [];

export function registerMockScript(
  match: (prompt: string, args: string[]) => boolean,
  run: (spawn: ClaudeSpawn) => Promise<ClaudeOut>,
): void {
  scripts.push({ match, run });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<boolean>((done) => {
    if (signal?.aborted) return done(false);
    const t = setTimeout(() => done(true), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        done(false);
      },
      { once: true },
    );
  });

let sessions = 0;

export type MockStream = {
  texts: string[];
  tools?: { name: string; input: Record<string, unknown> }[];
  result: string;
  isError?: boolean;
  costUsd?: number;
  delayMs?: number;
  edit?(): void;
};

// ponytail: the same stream-json envelope the real CLI writes, a line at a time with pauses, so
// the UI shows streaming and Cancel works
export async function mockStream(spawn: ClaudeSpawn, s: MockStream): Promise<ClaudeOut> {
  const resume = spawn.args.indexOf("--resume");
  const sessionId = resume >= 0 ? spawn.args[resume + 1] : `mock-session-${++sessions}`;
  const lines: string[] = [];
  const emit = async (m: unknown) => {
    const line = JSON.stringify(m);
    lines.push(line);
    spawn.onLine?.(line);
    return await sleep(s.delayMs ?? 150, spawn.signal);
  };
  const cancelled = (): ClaudeOut => ({ code: 130, stdout: `${lines.join("\n")}\n`, stderr: "" });
  const started = Date.now();
  if (!(await emit({ type: "system", subtype: "init", session_id: sessionId, model: "mock", tools: [] })))
    return cancelled();
  for (const t of s.tools ?? [])
    if (
      !(await emit({
        type: "assistant",
        session_id: sessionId,
        message: { content: [{ type: "tool_use", id: `tu-${lines.length}`, name: t.name, input: t.input }] },
      }))
    )
      return cancelled();
  s.edit?.();
  for (const text of s.texts)
    if (!(await emit({ type: "assistant", session_id: sessionId, message: { content: [{ type: "text", text }] } })))
      return cancelled();
  await emit({
    type: "result",
    subtype: s.isError ? "error_during_execution" : "success",
    is_error: !!s.isError,
    result: s.result,
    session_id: sessionId,
    duration_ms: Date.now() - started,
    total_cost_usd: s.costUsd ?? 0.0123,
    usage: { input_tokens: 12, cache_read_input_tokens: 18400, output_tokens: 640 },
  });
  return { code: s.isError ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

// ponytail: the last registered script that matches wins — the next wave's specific scripts beat these
registerMockScript(
  () => true,
  (spawn) => mockStream(spawn, { texts: ["ok"], result: "ok", delayMs: 20 }),
);

const CHAT_ANSWER = [
  "Le menu contextuel d'un sectionneur dépend de son type. ",
  'Selon la spécification, « Selon le type de sectionneur, le menu contextuel diffère » [SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"]. ',
  "Un sectionneur sans télécommande (TK) propose Propriétés et les commandes d'autorisation et de confirmation d'ouverture et de fermeture ",
  '[SOSIE_211_D401-1_3#§5.6.6 "Le menu contextuel d\'un sectionneur sans TK propose"]. ',
  "Les documents ne précisent pas l'ordre d'affichage des commandes dans le menu.",
];

registerMockScript(
  (prompt) => prompt.includes("ask-docs"),
  (spawn) =>
    mockStream(spawn, {
      tools: [
        { name: "mcp__testimus__rag_search", input: { query: "menu contextuel sectionneur" } },
        { name: "mcp__testimus__rag_passage", input: { ref: "SOSIE_211_D401-1_3#§5.6.6" } },
      ],
      texts: CHAT_ANSWER,
      result: CHAT_ANSWER.join(""),
    }),
);

function editTest(cwd: string, prompt: string): string | null {
  const id = prompt.match(/^Files: tests\/([^/]+)\/test\.md/m)?.[1];
  if (!id) return null;
  const file = join(cwd, "tests", id, "test.md");
  if (!existsSync(file)) return null;
  const step = Number(prompt.match(/^Scope: step (\d+) /m)?.[1] ?? 1);
  const md = readFileSync(file, "utf8");
  const parts = md.split(/(?=^## Step \d+)/m);
  const i = parts.findIndex((p) => p.startsWith(`## Step ${step}`));
  if (i < 0) return null;
  parts[i] = parts[i].replace(/(### Action\r?\n\r?\n[^\r\n]+)/, "$1 Vérifier l'affichage avant de continuer.");
  writeFileSync(file, parts.join(""), "utf8");
  return `Step ${step} of ${id}`;
}

registerMockScript(
  (prompt) => prompt.startsWith("Scope:") || prompt.startsWith("Use the edit-test skill"),
  (spawn) => {
    let edited: string | null = null;
    return mockStream(spawn, {
      tools: [{ name: "Read", input: { file_path: "tests/…/test.md" } }],
      edit: () => {
        edited = editTest(spawn.cwd, spawn.stdin);
      },
      texts: ["I read the test and its sources. ", "I clarified the action of the step."],
      get result() {
        return edited ? `Changed: ${edited} — the action now says what to check first.` : "Nothing to change.";
      },
    });
  },
);

export async function mockSpawnClaude(run: ClaudeSpawn): Promise<ClaudeOut> {
  const state = process.env.TESTIMUS_MOCK_CLAUDE;
  if (state === "absent") throw new Error("spawn claude ENOENT — claude executable not found on PATH");
  if (run.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code, mock)\n", stderr: "" };
  if (state === "logged-out") {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Invalid API key · Please run /login",
      duration_ms: 40,
    });
    run.onLine?.(line);
    return { code: 1, stdout: `${line}\n`, stderr: "" };
  }
  // ponytail: TESTIMUS_MOCK_CLAUDE_MS=<ms> makes every run take that long, so a conversion can be watched
  const ms = Number(process.env.TESTIMUS_MOCK_CLAUDE_MS) || 0;
  if (ms) await new Promise((r) => setTimeout(r, ms));
  for (let i = scripts.length - 1; i >= 0; i--)
    if (scripts[i].match(run.stdin, run.args)) return await scripts[i].run(run);
  return { code: 1, stdout: "", stderr: "mock claude: no script" };
}
