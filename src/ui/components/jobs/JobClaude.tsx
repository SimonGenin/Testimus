import { useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { useRead } from "../../lib/data/query.ts";
import { ClaudeActivity } from "../claude/ClaudeActivity.tsx";

// ponytail: « Claude's work » in the job panel — from the job's events while it runs (and while this server keeps
// them), else read from the runs' own folders when opened: a finished job's file keeps only each run's summary
export function JobClaude({
  job,
  events,
  now,
  model,
  effort,
}: {
  job: Job;
  events: JobEvent[];
  now: number;
  model?: string;
  effort?: string;
}) {
  const running = job.status === "running";
  const kept = !running && !events.some((e) => e.type === "claude") && (job.processes ?? []).some((p) => !!p.run);
  const [open, setOpen] = useState(!kept);
  const read = useRead("jobs.activity", { id: job.id }, { enabled: kept && open });
  return (
    <ClaudeActivity
      events={kept ? ((read.data?.events ?? []) as JobEvent[]) : events}
      running={running}
      now={now}
      model={model}
      effort={effort}
      open={open}
      onOpenChange={setOpen}
      reading={kept && open && !read.data && !read.error}
    />
  );
}
