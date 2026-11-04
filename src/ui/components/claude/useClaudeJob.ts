import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandInput, CommandName } from "../../../core/commands/index.ts";
import type { Job, JobEvent } from "../../../core/types.ts";
import { ApiError } from "../../lib/data/client.ts";
import { useJobEvents } from "../../lib/data/events.ts";
import { execute, type Prefix, useRead } from "../../lib/data/query.ts";

type Waiting = {
  onEvent: (e: JobEvent) => void;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

// ponytail: a cancelled run keeps what Claude already wrote — the error carries the job's result, as waitJob does
function settle(w: Waiting, job: Job): void {
  if (job.status === "done") {
    w.resolve(job.result);
    return;
  }
  const e = new ApiError(job.error || (job.status === "cancelled" ? "Cancelled." : "The job failed."));
  if (job.status === "cancelled") {
    e.cancelled = true;
    e.result = job.result;
  }
  w.reject(e);
}

// ponytail: one Claude job at a time, started through the data layer and followed by its events (the stream as it
// comes) and by its read (jobs.show, re-read by the bridge on every status: a status missed between two reconnects
// still ends the wait)
export function useClaudeJob() {
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const waiting = useRef<Waiting | null>(null);

  const end = useCallback((job: Job) => {
    const w = waiting.current;
    if (!w || job.status === "running") return;
    waiting.current = null;
    setJobId(null);
    settle(w, job);
  }, []);

  useJobEvents(jobId, (e) => {
    waiting.current?.onEvent(e);
    if (e.type === "status") end(e.job);
  });
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId });
  const job = shown.data?.job as Job | undefined;
  useEffect(() => {
    if (job && job.id === jobId) end(job);
  }, [job, jobId, end]);

  const start = useCallback(
    async <T>(
      name: CommandName,
      input: unknown,
      onEvent: (e: JobEvent) => void,
      flushFirst?: Prefix[],
      onStarted?: (jobId: string) => void,
    ): Promise<T> => {
      const r = (await execute(client, name, input as CommandInput<typeof name>, {
        invalidates: "none",
        flushFirst,
      })) as unknown;
      const id = (r as { jobId?: unknown })?.jobId;
      if (typeof id !== "string") return r as T;
      onStarted?.(id);
      return new Promise<T>((resolve, reject) => {
        waiting.current = { onEvent, resolve: resolve as (v: unknown) => void, reject };
        setJobId(id);
      });
    },
    [client],
  );

  return { jobId, start };
}
