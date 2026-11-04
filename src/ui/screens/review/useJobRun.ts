import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { CommandInput, CommandName } from "../../../core/commands/index.ts";
import type { Job } from "../../../core/types.ts";
import { execute, useRead } from "../../lib/data/query.ts";

type Ends = { done?: () => void; failed?: (error: string) => void };

const jobOf = (r: unknown) =>
  r && typeof r === "object" && typeof (r as { jobId?: unknown }).jobId === "string"
    ? (r as { jobId: string }).jobId
    : null;

// ponytail: a long command started from the screen — the job is read from jobs.show, which the event bridge keeps fresh;
// what it changed comes back through the bridge too, so the screen only says how it ended
export function useJobRun<N extends CommandName>(name: N) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const ends = useRef<Ends>({});
  const job = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId }).data as { job?: Job } | undefined;
  const status = jobId ? job?.job?.status : undefined;

  useEffect(() => {
    if (!jobId || !status || status === "running") return;
    setJobId(null);
    if (status === "done") ends.current.done?.();
    else ends.current.failed?.(job?.job?.error || "The job did not finish.");
  }, [jobId, status, job]);

  const start = async (input: CommandInput<N>, on: Ends = {}) => {
    ends.current = on;
    setStarting(true);
    try {
      const out = await execute(client, name, input, { invalidates: "none" });
      const id = jobOf(out);
      if (id) setJobId(id);
      else on.done?.();
    } catch (e) {
      on.failed?.(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return { start, running: starting || (!!jobId && status !== "done" && status !== "failed") };
}
