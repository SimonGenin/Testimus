import { useEffect, useMemo, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { useRead } from "../../lib/data/query.ts";
import { groupRepeats, type JobNode, jobTree, kindLabel, subjectLabel, subtree } from "../../lib/jobs.ts";
import { usePref } from "../../lib/prefs.ts";
import { KINDS, type StatusFilter, statusOf } from "./kinds.ts";

export type Filters = { text: string; status: StatusFilter; kind: string };

export const NO_FILTER: Filters = { text: "", status: "all", kind: "all" };

// ponytail: the jobs of the project (jobs.list, kept live by the event bridge), as a tree, filtered and grouped; the
// clock ticks every second while something runs, for the running durations
export function useJobs() {
  const read = useRead("jobs.list", {});
  const jobs = read.data === undefined ? null : Array.isArray(read.data) ? (read.data as Job[]) : [];
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [group, setGroup] = usePref("jobsGroup");
  const [now, setNow] = useState(Date.now());

  const anyRunning = !!jobs?.some((j) => j.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const all = jobs ?? [];
  const byId = useMemo(() => new Map(all.map((j) => [j.id, j])), [all]);
  const tree = useMemo(() => jobTree(all), [all]);
  const kinds = KINDS.find((t) => t.id === filters.kind)?.kinds;
  const needle = filters.text.trim().toLowerCase();
  const shown = useMemo(() => {
    const keep = (n: JobNode) =>
      subtree(n).some(
        (j) =>
          (filters.status === "all" || statusOf(j) === filters.status) &&
          (!kinds || kinds(j.kind)) &&
          (!needle ||
            `${kindLabel(j.kind)} ${subjectLabel(j, byId)} ${j.subject} ${j.id}`.toLowerCase().includes(needle)),
      );
    const roots = tree.filter(keep);
    return group ? groupRepeats(roots) : roots;
  }, [tree, filters.status, kinds, needle, group, byId]);

  const count = (s: StatusFilter) => all.filter((j) => s === "all" || statusOf(j) === s).length;

  return {
    jobs,
    failed: read.isError && !jobs,
    retry: () => void read.refetch(),
    byId,
    tree,
    shown,
    now,
    filters,
    setFilters,
    filtered: filters.status !== "all" || filters.kind !== "all" || !!needle,
    group,
    setGroup,
    count,
    finished: all.filter((j) => j.status !== "running").length,
    present: KINDS.filter((t) => all.some((j) => t.kinds(j.kind))),
  };
}
