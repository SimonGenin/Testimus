import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../lib/atomic.ts";
import type { ClaudeEvent } from "../types.ts";

export type Said = { at: string; event: ClaudeEvent };

const fileOf = (project: string, runId: string) => join(project, ".testimus", "runs", runId, "activity.jsonl");

// ponytail: what Claude said and did in one run, as its stream gave it, kept with the run — the job's file keeps only
// the run's summary (thousands of lines for a generation went there before), the panel of a finished job reads this
// when a run is opened (jobs.activity)
export function writeActivity(project: string, runId: string, said: Said[]): void {
  if (!said.length || !/^[\w-]+$/.test(runId)) return;
  try {
    writeAtomic(fileOf(project, runId), said.map((s) => JSON.stringify(s)).join("\n"));
  } catch {}
}

export function readActivity(project: string, runId: string): Said[] {
  const file = fileOf(project, runId);
  if (!/^[\w-]+$/.test(runId) || !existsSync(file)) return [];
  const out: Said[] = [];
  for (const line of readFileSync(file, "utf8").split("\n"))
    try {
      const s = JSON.parse(line) as Said;
      if (s?.event?.type) out.push(s);
    } catch {}
  return out;
}
