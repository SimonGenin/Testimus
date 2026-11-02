import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const KEEP_DAYS = 14;
export const TAIL_LINES = 40;

export function localDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA || join(homedir(), ".local", "share"), "Testimus");
}

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.APPDATA || join(homedir(), ".config"), "Testimus");
}

export const logDir = (env: NodeJS.ProcessEnv = process.env) => join(localDir(env), "logs");

export const logName = (d: Date) => `desktop-${d.toISOString().slice(0, 10)}.log`;

export function expired(names: string[], now: Date, days = KEEP_DAYS): string[] {
  const limit = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return names.filter((n) => {
    const m = n.match(/^desktop-(\d{4}-\d{2}-\d{2})\.log$/);
    return !!m && m[1] < limit;
  });
}

const tail: string[] = [];

export function lastLines(): string[] {
  return [...tail];
}

export function clearTail(): void {
  tail.length = 0;
}

export function log(source: "shell" | "core" | "ui-dev", line: string): void {
  const text = line.replace(/\s+$/, "");
  if (!text) return;
  if (source !== "shell") {
    tail.push(text);
    if (tail.length > TAIL_LINES) tail.shift();
  }
  const now = new Date();
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(join(logDir(), logName(now)), `${now.toISOString()} [${source}] ${text}\n`);
  } catch {}
}

export function pruneLogs(now = new Date()): void {
  try {
    const dir = logDir();
    for (const n of expired(readdirSync(dir), now)) if (statSync(join(dir, n)).isFile()) rmSync(join(dir, n));
  } catch {}
}
