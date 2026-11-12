import { z } from "zod";
import { sleep } from "../../shared/run/work.ts";
import { provideCommands } from "../claude/access.ts";
import { type Command, type Ctx, type Progress, UserError } from "../command.ts";
import { env } from "../env.ts";
import { startJob } from "../jobs.ts";
import { migrateOnOpen } from "../lib/media-migrate.ts";
import type { ClaudeEvent, JobCause } from "../types.ts";
import { commands as actions } from "./actions.ts";
import { commands as analysis } from "./analysis.ts";
import { commands as chat } from "./chat.ts";
import { commands as check } from "./check.ts";
import { commands as claude } from "./claude.ts";
import { commands as columns } from "./columns.ts";
import { commands as contexts } from "./contexts.ts";
import { commands as docs } from "./docs.ts";
import { commands as docsEdit } from "./docs-edit.ts";
import { commands as docsFolder } from "./docs-folder.ts";
import { commands as docsOverview } from "./docs-overview.ts";
import { commands as docsRead } from "./docs-read.ts";
import { commands as gen } from "./gen.ts";
import { commands as images } from "./images.ts";
import { commands as issue } from "./issue.ts";
import { commands as jobs } from "./jobs.ts";
import { commands as media } from "./media.ts";
import { commands as models } from "./models.ts";
import { commands as project } from "./project.ts";
import { commands as rag } from "./rag.ts";
import { commands as ragEval } from "./rag-eval.ts";
import { commands as ragGraph } from "./rag-graph.ts";
import { commands as ragIndex } from "./rag-index.ts";
import { commands as ragSettings } from "./rag-settings.ts";
import { commands as review } from "./review.ts";
import { commands as runs } from "./runs.ts";
import { commands as search } from "./search.ts";
import { commands as system } from "./system.ts";
import { commands as tests } from "./tests.ts";
import { commands as xray } from "./xray.ts";

type Defined =
  | (typeof project)[number]
  | (typeof docs)[number]
  | (typeof docsRead)[number]
  | (typeof docsEdit)[number]
  | (typeof docsFolder)[number]
  | (typeof docsOverview)[number]
  | (typeof media)[number]
  | (typeof columns)[number]
  | (typeof rag)[number]
  | (typeof search)[number]
  | (typeof ragIndex)[number]
  | (typeof ragEval)[number]
  | (typeof ragGraph)[number]
  | (typeof ragSettings)[number]
  | (typeof models)[number]
  | (typeof chat)[number]
  | (typeof claude)[number]
  | (typeof actions)[number]
  | (typeof contexts)[number]
  | (typeof tests)[number]
  | (typeof images)[number]
  | (typeof gen)[number]
  | (typeof check)[number]
  | (typeof analysis)[number]
  | (typeof review)[number]
  | (typeof runs)[number]
  | (typeof xray)[number]
  | (typeof issue)[number]
  | (typeof jobs)[number]
  | (typeof system)[number];

export type CommandMap = { [C in Defined as C["name"]]: C };
export type CommandName = keyof CommandMap;
export type CommandInput<N extends CommandName> = z.input<CommandMap[N]["input"]>;
export type CommandOutput<N extends CommandName> = z.output<CommandMap[N]["output"]>;
export type JobCommand = { [K in CommandName]: CommandMap[K] extends { job: string } ? K : never }[CommandName];
export type JobStart = { jobId: string };
/** what a call answers: the output, or for a command that runs as a job, the job's id (its result comes by the job) */
export type CallResult<N extends CommandName> = N extends JobCommand ? JobStart : CommandOutput<N>;

export const registry: Command[] = [
  ...project,
  ...docs,
  ...docsRead,
  ...docsEdit,
  ...docsFolder,
  ...docsOverview,
  ...media,
  ...columns,
  ...rag,
  ...search,
  ...ragIndex,
  ...ragEval,
  ...ragGraph,
  ...ragSettings,
  ...models,
  ...chat,
  ...claude,
  ...actions,
  ...contexts,
  ...tests,
  ...images,
  ...gen,
  ...check,
  ...analysis,
  ...review,
  ...runs,
  ...xray,
  ...issue,
  ...jobs,
  ...system,
].sort((a, b) => a.name.localeCompare(b.name));

const byName = new Map<string, Command>(registry.map((c) => [c.name, c]));
provideCommands(() => registry);

export function find(name: string): Command {
  const c = byName.get(name);
  if (!c) throw new UserError(`Unknown command ${name}.`, "testimus help lists the commands.");
  return c;
}

export type InvokeOpts = {
  project: string | null;
  llm?: boolean;
  signal?: AbortSignal;
  wait?: boolean;
  cause?: JobCause;
  onProgress?(p: Progress): void;
  onLog?(level: "info" | "warn" | "error", message: string): void;
  onClaude?(e: ClaudeEvent): void;
};

// ponytail: a field the command does not have is refused, never dropped — a page built against an older registry once
// asked usePack for its plan with dryRun and started the install instead
export function parseInput(c: Command, raw: unknown): unknown {
  const shape = (c.input as { shape?: Record<string, unknown> }).shape;
  if (shape && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const unknown = Object.keys(raw).filter((k) => !(k in shape));
    if (unknown.length)
      throw new UserError(
        `Invalid input for ${c.name} — unknown ${unknown.length === 1 ? "field" : "fields"}: ${unknown.join(", ")}`,
        `testimus help ${c.name}`,
      );
  }
  const r = c.input.safeParse(raw ?? {});
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    throw new UserError(`Invalid input for ${c.name} — ${msg}`, `testimus help ${c.name}`);
  }
  return r.data;
}

// ponytail: a label is a courtesy to the person reading the jobs — one that cannot be read (a test or an action not
// there) leaves the job without it, never fails it
function labelOf(c: Command, input: unknown, project: string | null): string | undefined {
  try {
    return c.label?.(input as never, project) || undefined;
  } catch {
    return undefined;
  }
}

function subjectOf(c: Command, input: unknown): string {
  if (c.subject) return c.subject(input as never);
  const s = JSON.stringify(input);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

export async function invoke(name: string, raw: unknown, opts: InvokeOpts): Promise<unknown> {
  const c = find(name);
  const input = parseInput(c, raw);
  const llm = opts.llm ? { llm: true } : {};
  const nested: NonNullable<Ctx["invoke"]> = (n, i, o) => invoke(n, i, { project: opts.project, ...llm, ...o });
  if (!c.global && !opts.project)
    throw new UserError("No project is open.", "Open or create a project first (testimus project init <dir>).");
  const migrating = opts.project && c.name !== "media.migrate" ? migrateOnOpen(opts.project) : null;
  if (migrating) await migrating;
  if (c.job) {
    const cause = c.cause?.(input as never) ?? opts.cause;
    // ponytail: a job remembers how to run it again unless its input is large (an upload) or a secret's (mcp: false)
    const text = c.mcp === false ? "" : JSON.stringify(input);
    const rerun = text && text.length <= 20000 ? { name: c.name, input } : undefined;
    const { job, done } = startJob(
      c.job,
      subjectOf(c, input),
      opts.project,
      (ctx) => c.run({ ...ctx, ...llm, invoke: nested }, input as never),
      opts.signal,
      { cause, rerun, label: labelOf(c, input, opts.project) },
    );
    if (opts.wait === false) return { jobId: job.id };
    return await done;
  }
  const paced = env.readMs(c.name);
  if (paced) await sleep(paced, opts.signal);
  const ctx: Ctx = {
    project: opts.project,
    ...llm,
    signal: opts.signal ?? new AbortController().signal,
    progress: (p) => opts.onProgress?.(p),
    log: (level, message) => opts.onLog?.(level, message),
    claude: (e) => opts.onClaude?.(e),
    invoke: nested,
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
