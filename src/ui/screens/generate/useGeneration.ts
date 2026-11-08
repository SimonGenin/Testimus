import { useState } from "react";
import type { GenTestProgress, Job, JobEvent } from "../../../core/types.ts";
import { useJobEvents } from "../../lib/data/events.ts";
import { useRead } from "../../lib/data/query.ts";
import { type GenOutput, landedIds, passagesRead } from "./GenResult.tsx";

export type Generation = {
  jobId: string | null;
  job: Job | null;
  events: JobEvent[];
  running: boolean;
  result: GenOutput | null;
  stopped: GenOutput | null;
  ids: string[];
  /** the tests the job writes and where each one is (its last progress line that says so) */
  writing: GenTestProgress[];
  read: number;
  follow: (jobId: string) => void;
};

// ponytail: a job written before the progress said which test it writes (or none said yet) is read from the ids it
// named, the last one being written
function writingOf(events: JobEvent[], ids: string[]): GenTestProgress[] {
  const said = events.findLast((e) => e.type === "progress" && !!e.gen);
  if (said?.type === "progress" && said.gen) return said.gen;
  return ids.map((id, k) => ({ id, state: k === ids.length - 1 ? "writing" : "written" }));
}

// ponytail: the generation this screen shows — the one started here, else the project's last one; its log is read
// once (jobs.show, read again on each status) and the events streamed since are added after it
export function useGeneration(): Generation {
  const [started, setStarted] = useState<string | null>(null);
  const jobs = useRead("jobs.list", {});
  const last = ((jobs.data ?? []) as Job[]).find((j) => j.kind === "generate")?.id ?? null;
  const jobId = started ?? last;
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId });
  const [live, setLive] = useState<{ id: string | null; list: JobEvent[] }>({ id: null, list: [] });
  useJobEvents(jobId, (e) => setLive((cur) => ({ id: jobId, list: cur.id === jobId ? [...cur.list, e] : [e] })));

  const data = jobId ? (shown.data as { job?: Job; events?: JobEvent[] } | undefined) : undefined;
  const known = data?.events ?? [];
  const after = known.at(-1)?.at ?? "";
  const streamed = live.id === jobId ? live.list : [];
  const events = [...known, ...streamed.filter((e) => e.at > after || !known.length)];
  const heard = streamed.findLast((e) => e.type === "status");
  let job = data?.job ?? null;
  if (heard?.type === "status" && (!job || job.status === "running")) job = heard.job;
  const result = job?.status === "done" ? ((job.result ?? null) as GenOutput | null) : null;
  const stopped = job && job.status !== "running" ? ((job.result ?? null) as GenOutput | null) : null;
  return {
    jobId,
    job,
    events,
    running: job?.status === "running",
    result,
    stopped,
    ids: landedIds(events, result),
    writing: writingOf(events, landedIds(events, null)),
    read: passagesRead(events),
    follow: (id) => {
      setLive({ id, list: [] });
      setStarted(id);
    },
  };
}
