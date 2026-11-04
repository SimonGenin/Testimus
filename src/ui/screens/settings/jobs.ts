import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { useJobEvents } from "../../lib/data/events.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";

export type Live = { message: string; pct: number | null };

export const pctOf = (done?: number, total?: number) => (total ? Math.round(((done ?? 0) / total) * 100) : null);

// ponytail: a job this screen started or found running — its last progress as the events come, its end once
// (done, failed or cancelled) when the event bridge has re-read jobs.show
export function useJob(
  jobId: string | null | undefined,
  onEnd?: (job: Job) => void,
  onEvent?: (e: JobEvent) => void,
): { job: Job | undefined; live: Live } {
  const [live, setLive] = useState<Live>({ message: "Starting", pct: null });
  useJobEvents(jobId, (e) => {
    if (e.type === "progress") setLive({ message: e.message, pct: pctOf(e.done, e.total) });
    onEvent?.(e);
  });
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId });
  const job = shown.data?.job;
  const ended = useRef<string | null>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (!job || job.status === "running" || ended.current === job.id) return;
    ended.current = job.id;
    end.current?.(job);
  }, [job]);
  const heard = live.message !== "Starting" || !job?.message;
  return {
    job,
    live: heard ? live : { message: job?.message ?? "", pct: pctOf(job?.progress?.done, job?.progress?.total) },
  };
}

export function useCancel() {
  const client = useQueryClient();
  return (jobId: string) =>
    void execute(client, "jobs.cancel", { id: jobId }, { invalidates: [["jobs.show", { id: jobId }]] }).catch((e) =>
      errorToast(e, "Could not cancel"),
    );
}
