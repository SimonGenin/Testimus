import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";

// ponytail: the job a panel shows, by its id — its log from jobs.show, the jobs around it (where it came from, what it
// runs inside, the diagnosis after its failure) from jobs.list, both kept live by the event bridge; the list's copy
// wins over a read that still says running for a job the list already saw end
export function useJobDetail(id: string, onOpen: (id: string) => void) {
  const client = useQueryClient();
  const read = useRead("jobs.show", { id });
  const list = useRead("jobs.list", {});
  const byId = useMemo(() => new Map((list.data ?? []).map((j) => [j.id, j])), [list.data]);
  const shown = (read.data as { job?: Job | null; events?: JobEvent[] } | null | undefined)?.job ?? null;
  const events = (read.data as { events?: JobEvent[] } | null | undefined)?.events ?? [];
  const listed = byId.get(id);
  const job: Job | null =
    shown && listed
      ? shown.status !== "running" || listed.status === "running"
        ? { ...listed, ...shown, steps: listed.steps ?? shown.steps, processes: listed.processes ?? shown.processes }
        : listed
      : (shown ?? listed ?? null);
  const diagnosis = (list.data ?? []).find((j) => j.kind === "actions.triage" && j.cause?.jobId === id);

  const cancel = () =>
    void execute(client, "jobs.cancel", { id }, { invalidates: [["jobs.show", { id }]] }).catch((e) =>
      errorToast(e, "Could not cancel the job"),
    );

  const again = job?.rerun
    ? () =>
        execute(client, "jobs.rerun", { id }, { invalidates: [["jobs.list"]] })
          .then((r) => r?.jobId && onOpen(r.jobId))
          .catch((e) => errorToast(e, "Could not run the job again"))
    : undefined;

  return { job, events, byId, diagnosis, cancel, again, failed: !!read.error && !job };
}
