import { resolve } from "node:path";
import { scope, sleep } from "../../shared/run/work.ts";
import { type OverviewMode, type OverviewResult, writeOverviewRun } from "../claude/overview.ts";
import type { JobRun } from "../claude/prompt.ts";
import { insideClaude } from "../claude/run.ts";
import { claudeVersion } from "../claude/status.ts";
import type { Ctx } from "../command.ts";
import { outsideJobs, runningOf, startJob } from "../jobs.ts";
import { indexWork } from "./docs-index.ts";
import { overviewOption } from "./overview.ts";

export const OVERVIEW_JOB = "docs.overview";
export const OVERVIEW_LABEL = "How the documents fit together";
export const promptsUsed = ["overview-update", "overview-full"];

const keyOf = (project: string) => resolve(project).toLowerCase();

// ponytail: per project, an update asked for after an import that has not begun writing — the other conversions of the
// batch, whose index run is the same, join it (a folder of 10 documents makes one update)
const asked = new Map<string, object>();
// ponytail: per project, the update writing now — the next one writes after it, never beside it
const writing = new Map<string, Promise<unknown>>();

async function idle(ctx: Ctx, project: string): Promise<void> {
  for (;;) {
    const gens = runningOf(project, "generate");
    const busy = [...indexWork(project), ...gens];
    if (!busy.length) return;
    ctx.progress({ message: gens.length ? "Waiting for the generation to end" : "Waiting for the imports to end" });
    await scope(() => Promise.allSettled(busy), { signal: ctx.signal });
  }
}

// ponytail: the overview reads every document and must not be rewritten under a generation reading it: it waits for the
// conversions, the index run and the generations of the project to end (in line, as the index), then for its turn —
// and for them again once the update before it ended, since one may have begun meanwhile
async function inTurn<T>(ctx: Ctx, project: string, work: () => Promise<T>): Promise<T> {
  ctx.steps?.([
    { id: "queue", label: "Wait for the imports, the index and the generations" },
    { id: "write", label: "Claude writes" },
  ]);
  ctx.step?.("queue");
  await sleep(200, ctx.signal);
  await idle(ctx, project);
  const key = keyOf(project);
  const before = writing.get(key);
  const mine = (async () => {
    if (before) {
      await scope(() => before.catch(() => {}), { signal: ctx.signal });
      await idle(ctx, project);
    }
    ctx.step?.("write");
    return work();
  })();
  writing.set(key, mine);
  try {
    return await mine;
  } finally {
    if (writing.get(key) === mine) writing.delete(key);
  }
}

export function runOverviewJob(
  ctx: Ctx,
  project: string,
  input: { mode: OverviewMode } & JobRun,
  onTurn?: () => void,
): Promise<OverviewResult> {
  return inTurn(ctx, project, () => {
    onTurn?.();
    return writeOverviewRun(ctx, project, input);
  });
}

// ponytail: per project, every update asked after an import, chained — a one-shot CLI command waits for them to end
const pending = new Map<string, Promise<unknown>>();

export const overviewAsked = (project: string): Promise<unknown> => pending.get(keyOf(project)) ?? Promise.resolve();

// ponytail: after an import or a conversion (once its index run ended), when the option is on and Claude is on this
// PC — a job of its own, nobody's child; the asks of the same batch join it while it waits its turn. Never from inside
// a Claude run (the MCP server it calls): that run's own job would start another Claude run behind the user's back
export function overviewAfterImport(project: string, claude: JobRun = {}): void {
  const key = keyOf(project);
  if (insideClaude() || asked.has(key) || !overviewOption(project).enabled) return;
  const token = {};
  asked.set(key, token);
  const done = () => {
    if (asked.get(key) === token) asked.delete(key);
  };
  const ended = claudeVersion().then(
    (probe) => {
      if (!probe.ok) return done();
      const job = outsideJobs(() =>
        startJob(
          OVERVIEW_JOB,
          "auto",
          project,
          (ctx) => runOverviewJob(ctx, project, { mode: "auto", model: claude.model, effort: claude.effort }, done),
          undefined,
          { rerun: { name: OVERVIEW_JOB, input: { mode: "auto" } }, label: OVERVIEW_LABEL },
        ),
      );
      return job.done.then(done, done);
    },
    () => done(),
  );
  pending.set(key, Promise.all([pending.get(key), ended]));
}
