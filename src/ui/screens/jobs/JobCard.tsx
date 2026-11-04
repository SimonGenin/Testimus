import type { Job } from "../../../core/types.ts";
import { List } from "../../components/ui/List.tsx";
import { kindLabel, subjectLabel } from "../../lib/jobs.ts";
import { JobState, KindTile } from "./JobState.tsx";

// ponytail: the jobs a job is linked to (the ones inside it, the ones started after it) — a row opens one
export function JobCards({
  label,
  jobs,
  byId,
  now,
  onOpen,
}: {
  label: string;
  jobs: Job[];
  byId: Map<string, Job>;
  now: number;
  onOpen(id: string): void;
}) {
  return (
    <List<Job>
      label={label}
      items={jobs}
      getKey={(j) => j.id}
      divided
      onSelect={onOpen}
      renderItem={(job) => {
        const r = job.result as { summary?: string } | undefined;
        const summary = job.kind === "actions.triage" && typeof r?.summary === "string" ? r.summary : "";
        return {
          lead: <KindTile kind={job.kind} size="sm" />,
          title: kindLabel(job.kind),
          meta: summary || subjectLabel(job, byId) || undefined,
          trail: <JobState job={job} now={now} />,
        };
      }}
    />
  );
}
