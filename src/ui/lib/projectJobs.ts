import { useEffect, useRef } from "react";
import type { Job } from "../../core/types.ts";
import { project } from "./data/client.ts";
import { useRead } from "./data/query.ts";

// ponytail: the open project's jobs (none without a project), live (jobs.list kept by the event bridge); a job this page just started that the
// list does not show yet is asked for once the read under way has answered, even when the stream has not said it started
export function useProjectJobs(started: (string | undefined)[]): Job[] {
  const jobs = useRead("jobs.list", {}, { enabled: !!project() });
  const list = (Array.isArray(jobs.data) ? jobs.data : []) as Job[];
  const asked = useRef(new Set<string>());
  const missing = started.find((id) => id && !asked.current.has(id) && !list.some((j) => j.id === id));
  const { refetch, isFetching } = jobs;
  useEffect(() => {
    if (!missing || isFetching) return;
    asked.current.add(missing);
    void refetch();
  }, [missing, isFetching, refetch]);
  return list;
}
