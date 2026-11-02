import type { z } from "zod";
import type { ClaudeEvent } from "./types.ts";

export type Progress = { message: string; done?: number; total?: number };

export type Ctx = {
  project: string | null;
  signal: AbortSignal;
  jobId?: string;
  progress(p: Progress): void;
  log(level: "info" | "warn" | "error", message: string): void;
  claude(event: ClaudeEvent): void;
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
  run(ctx: Ctx, input: z.output<I>): Promise<z.input<O>>;
};

export function command<I extends z.ZodType, O extends z.ZodType>(c: Command<I, O>): Command<I, O> {
  return c;
}

export class UserError extends Error {
  readonly fix?: string;
  constructor(message: string, fix?: string) {
    super(message);
    this.fix = fix;
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
