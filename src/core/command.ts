import type { z } from "zod";
import type { ClaudeEvent, JobCause, PullInfo } from "./types.ts";

export type Progress = { message: string; done?: number; total?: number; pull?: PullInfo };

export type Ctx = {
  project: string | null;
  signal: AbortSignal;
  jobId?: string;
  progress(p: Progress): void;
  log(level: "info" | "warn" | "error", message: string): void;
  claude(event: ClaudeEvent): void;
  // ponytail: a job's named phases — steps() declares them all up front (waiting), step() starts one and ends the
  // one before it; outside a job they do nothing
  steps?(list: { id: string; label: string }[]): void;
  step?(id: string, label?: string): void;
};

export type Command<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: `${string}.${string}`;
  summary: string;
  input: I;
  output: O;
  mutates: boolean;
  job?: string;
  global?: boolean;
  // ponytail: false keeps a command off the MCP server (secrets): the page and the CLI have it, no Claude session does
  mcp?: false;
  positional?: string[];
  subject?(input: z.output<I>): string;
  cause?(input: z.output<I>): JobCause | undefined;
  run(ctx: Ctx, input: z.output<I>): Promise<z.input<O>>;
};

export function command<I extends z.ZodType, O extends z.ZodType>(c: Command<I, O>): Command<I, O> {
  return c;
}

// ponytail: `code` is a stable name a page or a script can branch on (`conflict`: the file moved on disk since it was
// read) instead of matching the message
export class UserError extends Error {
  readonly fix?: string;
  readonly code?: string;
  constructor(message: string, fix?: string, code?: string) {
    super(message);
    this.fix = fix;
    this.code = code;
  }
}

export function notBuilt(name: string): never {
  throw new UserError(`${name} is not built yet.`, "See ROADMAP.md (RAG v2 and desktop sections).");
}

export function projectOf(ctx: Ctx): string {
  if (!ctx.project)
    throw new UserError("No project is open.", "Open or create a project first (testimus project init <dir>).");
  return ctx.project;
}

export function quietCtx(project: string | null, signal: AbortSignal = new AbortController().signal): Ctx {
  return { project, signal, progress() {}, log() {}, claude() {} };
}
