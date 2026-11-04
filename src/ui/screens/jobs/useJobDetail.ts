import { useQueryClient } from "@tanstack/react-query";
import type { Job, JobEvent } from "../../../core/types.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { useCancel } from "../settings/jobs.ts";

// ponytail: the job shown in the detail — its log from jobs.show (kept live by the event bridge); the list's copy wins
// over a read that still says running for a job the list already saw end
export function useJobDetail(listed: Job, onOpen: (id: string) => void) {
  const client = useQueryClient();
  const read = useRead("jobs.show", { id: listed.id });
  const live = (read.data as { job?: Job | null; events?: JobEvent[] } | null | undefined)?.job ?? null;
  const events = (read.data as { events?: JobEvent[] } | null | undefined)?.events ?? [];
  const job: Job =
    live && (live.status !== "running" || listed.status === "running")
      ? { ...listed, ...live, steps: listed.steps ?? live.steps, processes: listed.processes ?? live.processes }
      : listed;

  const stop = useCancel();
  const cancel = () => stop(job.id);

  const again = job.rerun
    ? () =>
        execute(client, "jobs.rerun", { id: job.id }, { invalidates: [["jobs.list"]] })
          .then((r) => r?.jobId && onOpen(r.jobId))
          .catch((e) => errorToast(e, "Could not run the job again"))
    : undefined;

  return { job, events, cancel, again };
}
