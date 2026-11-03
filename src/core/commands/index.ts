import { z } from "zod";
import { type Command, type Ctx, type Progress, UserError } from "../command.ts";
import { startJob } from "../jobs.ts";
import type { ClaudeEvent } from "../types.ts";
import { commands as actions } from "./actions.ts";
import { commands as chat } from "./chat.ts";
import { commands as check } from "./check.ts";
import { commands as claude } from "./claude.ts";
import { commands as columns } from "./columns.ts";
import { commands as contexts } from "./contexts.ts";
import { commands as docs } from "./docs.ts";
import { commands as gen } from "./gen.ts";
import { commands as images } from "./images.ts";
import { commands as jobs } from "./jobs.ts";
import { commands as models } from "./models.ts";
import { commands as project } from "./project.ts";
import { commands as rag } from "./rag.ts";
import { commands as ragEval } from "./rag-eval.ts";
import { commands as ragGraph } from "./rag-graph.ts";
import { commands as ragIndex } from "./rag-index.ts";
import { commands as review } from "./review.ts";
import { commands as system } from "./system.ts";
import { commands as tests } from "./tests.ts";
import { commands as traces } from "./traces.ts";
import { commands as xray } from "./xray.ts";

export const registry: Command[] = [
  ...project,
  ...docs,
  ...traces,
  ...columns,
  ...rag,
  ...ragIndex,
  ...ragEval,
  ...ragGraph,
  ...models,
  ...chat,
  ...claude,
  ...actions,
  ...contexts,
  ...tests,
  ...images,
  ...gen,
  ...check,
  ...review,
  ...xray,
  ...jobs,
  ...system,
].sort((a, b) => a.name.localeCompare(b.name));

const byName = new Map<string, Command>(registry.map((c) => [c.name, c]));

export function find(name: string): Command {
  const c = byName.get(name);
  if (!c) throw new UserError(`Unknown command ${name}.`, "testimus help lists the commands.");
  return c;
}

export type InvokeOpts = {
  project: string | null;
  signal?: AbortSignal;
  wait?: boolean;
  onProgress?(p: Progress): void;
  onLog?(level: "info" | "warn" | "error", message: string): void;
  onClaude?(e: ClaudeEvent): void;
};

export function parseInput(c: Command, raw: unknown): unknown {
  const r = c.input.safeParse(raw ?? {});
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    throw new UserError(`Invalid input for ${c.name} — ${msg}`, `testimus help ${c.name}`);
  }
  return r.data;
}

function subjectOf(c: Command, input: unknown): string {
  if (c.subject) return c.subject(input as never);
  const s = JSON.stringify(input);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

export async function invoke(name: string, raw: unknown, opts: InvokeOpts): Promise<unknown> {
  const c = find(name);
  const input = parseInput(c, raw);
  if (!c.global && !opts.project)
    throw new UserError("No project is open.", "Open or create a project first (testimus project init <dir>).");
  if (c.job) {
    const { job, done } = startJob(
      c.job,
      subjectOf(c, input),
      opts.project,
      (ctx) => c.run(ctx, input as never),
      opts.signal,
    );
    if (opts.wait === false) return { jobId: job.id };
    return await done;
  }
  const ctx: Ctx = {
    project: opts.project,
    signal: opts.signal ?? new AbortController().signal,
    progress: (p) => opts.onProgress?.(p),
    log: (level, message) => opts.onLog?.(level, message),
    claude: (e) => opts.onClaude?.(e),
  };
  return await c.run(ctx, input as never);
}

export function describe(c: Command): {
  name: string;
  summary: string;
  mutates: boolean;
  job: boolean;
  input: unknown;
} {
  return {
    name: c.name,
    summary: c.summary,
    mutates: c.mutates,
    job: !!c.job,
    input: z.toJSONSchema(c.input, { io: "input" }),
  };
}
