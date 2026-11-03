import type { Job } from "../../../core/types.ts";
import { kindLabel, subjectLabel } from "../../lib/jobs.ts";
import { JobState, KindTile } from "./JobState.tsx";

export function JobCard({
  job,
  byId,
  now,
  onOpen,
}: {
  job: Job;
  byId: Map<string, Job>;
  now: number;
  onOpen(id: string): void;
}) {
  const r = job.result as { summary?: string } | undefined;
  const subject = subjectLabel(job, byId);
  return (
    <button type="button" className="jd-card" onClick={() => onOpen(job.id)}>
      <KindTile kind={job.kind} small />
      <span className="jd-cardtext">
        <span className="jd-cardtitle">{kindLabel(job.kind)}</span>
        {job.kind === "actions.triage" && typeof r?.summary === "string" && r.summary ? (
          <span className="jd-cardsum">{r.summary}</span>
        ) : (
          subject && <span className="muted">{subject}</span>
        )}
      </span>
      <JobState job={job} now={now} />
    </button>
  );
}
