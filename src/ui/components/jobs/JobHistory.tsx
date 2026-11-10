import { useState } from "react";
import type { Job } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { kindLabel, resultLine, whenLabel } from "../../lib/jobs.ts";
import { useNow } from "../../lib/now.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { List } from "../ui/List.tsx";
import { JobState, KindTile } from "./JobState.tsx";

const FIRST = 5;

// ponytail: what happened to one test or one document, newest first — the jobs that changed its files or were given
// it (jobs.list about); a job whose own job inside is listed too stands back for it (a conversion's re-check of the
// tests citing it is the check); a row opens the job panel
export function JobHistory({ about, label }: { about: string; label: string }) {
  const app = useApp();
  const read = useRead("jobs.list", { about });
  const [all, setAll] = useState(false);
  const jobs = read.data ?? [];
  const running = jobs.some((j) => j.status === "running");
  const now = useNow(1000, running);
  const shown = jobs.filter((j) => !jobs.some((x) => x.parentId === j.id));
  const rows = all ? shown : shown.slice(0, FIRST);
  return (
    <>
      <List<Job>
        label={label}
        items={rows}
        getKey={(j) => j.id}
        divided
        loading={!read.data && 3}
        reading="jobs.list"
        empty={
          read.data && (
            <EmptyState
              compact
              icon="history"
              title="Nothing yet"
              text="The work that changes it shows here, kept 30 days."
            />
          )
        }
        onSelect={app.openJob}
        renderItem={(job) => {
          const rest = job.status === "done" ? resultLine(job).split(" · ").slice(1).join(" · ") : "";
          return {
            lead: <KindTile kind={job.kind} size="sm" />,
            title: kindLabel(job.kind),
            meta: [whenLabel(job.startedAt, now), rest].filter(Boolean).join(" · "),
            trail: <JobState job={job} now={now} />,
          };
        }}
      />
      {!all && shown.length > FIRST && (
        <Button variant="quiet" size="sm" label={`Show ${shown.length - FIRST} more`} onClick={() => setAll(true)} />
      )}
    </>
  );
}
