import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveExe } from "../../shared/run/process.ts";
import { scope, TimeoutError, timeout } from "../../shared/run/work.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { readSettings } from "../lib/project.ts";
import type { ClaudeEvent, Diagnosis } from "../types.ts";
import { diagnose } from "./diagnose.ts";
import type { PromptTemplate } from "./prompt.ts";
import { eventsOf } from "./stream.ts";

export function claudeExe(): string {
  const set = readSettings().claude.exe.trim();
  if (set) return set;
  const win = process.platform === "win32";
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const ext of win ? [".exe", ".cmd", ".bat"] : [""]) {
      const f = join(dir, `claude${ext}`);
      if (existsSync(f)) return f;
    }
  const local = join(env.homeDir(), ".local", "bin", win ? "claude.exe" : "claude");
  return existsSync(local) ? local : "claude";
}

// ponytail: an .exe runs without a shell and takes its arguments as they are; through a .cmd/.bat shim cmd
// re-reads the line, so an argument with a space is wrapped in plain quotes and a cmd metacharacter is refused
export function forShell(exe: string, args: string[]): { exe: string; args: string[] } {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(exe)) return { exe, args };
  const q = (s: string) => {
    if (/[&|<>^%!"\r\n]/.test(s))
      throw new UserError(
        `Claude Code is reached through ${exe}, and this argument cannot go through cmd safely: ${s.slice(0, 80)}`,
        "Remove & | < > ^ % ! or quotes from the model name, the context paths or the project path, or install the native claude.exe (irm https://claude.ai/install.ps1 | iex).",
      );
    return /[\s()]/.test(s) || s === "" ? `"${s}"` : s;
  };
  return { exe: q(exe), args: args.map(q) };
}

function claudeCommand(args: string[]): { exe: string; args: string[] } {
  return forShell(resolveExe(claudeExe()), args);
}

export const CONNECT = [
  {
    title: "Install Claude Code",
    cmd: "irm https://claude.ai/install.ps1 | iex",
    hint: "In PowerShell, no admin rights needed. With Node installed, `npm install -g @anthropic-ai/claude-code` works too.",
  },
  {
    title: "Sign in once, in a terminal",
    cmd: "claude",
    hint: "It opens your browser to sign in with your Claude account, then the terminal can be closed.",
  },
];

export type Probe = { ok: boolean; text: string };

const firstLine = (s: string) => s.trim().split(/\r?\n/)[0]?.trim() ?? "";

export const VERSION_TIMEOUT_MS = 10000;

let probe: { key: string; run: Promise<Probe> } | null = null;

const failure = (e: unknown) =>
  e instanceof TimeoutError
    ? `claude --version did not answer in ${VERSION_TIMEOUT_MS / 1000} s`
    : e instanceof Error
      ? e.message
      : String(e);

// ponytail: one `claude --version` per configured exe, shared by the dock, the doctor and claude.status; it gives up
// after VERSION_TIMEOUT_MS (the hanging claude is killed) and only an answer that worked is kept — a failure is asked
// again next time; a run that answered folds it to ok. A caller's signal ends its own wait, not the shared probe
export function claudeVersion(refresh = false, signal?: AbortSignal): Promise<Probe> {
  const exe = claudeExe();
  if (refresh || !probe || probe.key !== exe) {
    const run: Promise<Probe> = timeout(VERSION_TIMEOUT_MS, (s) =>
      env.spawnClaude({ ...claudeCommand(["--version"]), cwd: tmpdir(), stdin: "", signal: s }),
    )
      .then((out) => {
        const line = firstLine(out.code === 0 ? out.stdout : out.stderr || out.stdout);
        return { ok: out.code === 0, text: line || `claude exited with code ${out.code}` };
      })
      .catch((e: unknown) => ({ ok: false, text: failure(e) }));
    const mine = { key: exe, run };
    probe = mine;
    void run.then((r) => {
      if (!r.ok && probe === mine) probe = null;
    });
  }
  const shared = probe.run;
  return signal ? scope(() => shared, { signal }) : shared;
}

export function claudeAnswered(): void {
  probe = { key: claudeExe(), run: Promise.resolve({ ok: true, text: "claude answered a run" }) };
}

export function resetProbe(): void {
  probe = null;
}

const SIGN_IN = "reply ok";

export const prompts: PromptTemplate[] = [
  {
    id: "sign-in",
    name: "Is Claude signed in",
    group: "System check",
    usedBy: ["Settings › Claude: Check", "claude.status"],
    text: () => SIGN_IN,
  },
];

export type SignIn = { signedIn: boolean; text: string; diagnosis?: Diagnosis; costUsd?: number };

export async function checkSignedIn(signal?: AbortSignal): Promise<SignIn> {
  const out = await Promise.resolve()
    .then(() =>
      env.spawnClaude({
        ...claudeCommand([
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--model",
          "haiku",
          "--strict-mcp-config",
        ]),
        cwd: tmpdir(),
        stdin: SIGN_IN,
        signal,
      }),
    )
    .catch((e: unknown) => ({ code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) }));
  let result: Extract<ClaudeEvent, { type: "result" }> | undefined;
  for (const line of out.stdout.split(/\r?\n/)) for (const e of eventsOf(line)) if (e.type === "result") result = e;
  if (result?.ok && out.code === 0) {
    claudeAnswered();
    return { signedIn: true, text: result.text, costUsd: result.costUsd };
  }
  const text = result?.text || out.stderr.trim() || `claude exited with code ${out.code}`;
  return { signedIn: false, text, diagnosis: diagnose(`${text}\n${out.stderr}`) };
}
