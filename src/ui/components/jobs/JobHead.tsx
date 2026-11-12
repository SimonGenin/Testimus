import * as stylex from "@stylexjs/stylex";
import type { Job } from "../../../core/types.ts";
import { clock, duration, kindLabel, quietLine, quietOf } from "../../lib/jobs.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { type } from "../ui/type.ts";
import { JobState } from "./JobState.tsx";

const styles = stylex.create({
  head: { display: "flex", alignItems: "center", gap: space.s3 },
  meta: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    color: color.textMuted,
  },
  mono: { color: color.text },
  quiet: { color: color.warning },
  link: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

const WHY: Record<string, string> = {
  "after-failure": "After the failure of",
  "follow-up": "Follow-up of",
  retry: "Run again from",
};

// ponytail: under the panel's title — where the job is, how long it took, when, what it came from, and its one action
export function JobHead({
  job,
  byId,
  now,
  onCancel,
  onAgain,
  onOpen,
}: {
  job: Job;
  byId: Map<string, Job>;
  now: number;
  onCancel: () => void;
  onAgain?: () => void;
  onOpen: (id: string) => void;
}) {
  const origin = job.cause ? byId.get(job.cause.jobId) : undefined;
  const parent = job.parentId ? byId.get(job.parentId) : undefined;
  const running = job.status === "running";
  const quiet = quietOf(job, now);
  return (
    <div {...stylex.props(styles.head)}>
      <div {...stylex.props(type.small, styles.meta)}>
        <JobState job={job} now={now} timed={false} />
        <span {...stylex.props(type.code, styles.mono)}>{duration(job, now)}</span>
        <span>
          {running ? "started " : ""}
          {clock(job.startedAt)}
          {job.endedAt ? ` → ${clock(job.endedAt)}` : ""}
        </span>
        {quiet && !quiet.stuck && <span {...stylex.props(styles.quiet)}>{quietLine(quiet)}</span>}
        {origin && job.cause && (
          <span {...stylex.props(styles.link)}>
            {WHY[job.cause.why]}
            <Button variant="quiet" size="xs" label={kindLabel(origin.kind)} onClick={() => onOpen(origin.id)} />
          </span>
        )}
        {parent && (
          <span {...stylex.props(styles.link)}>
            Inside
            <Button variant="quiet" size="xs" label={kindLabel(parent.kind)} onClick={() => onOpen(parent.id)} />
          </span>
        )}
      </div>
      {running ? (
        <Button variant={quiet?.stuck ? "danger" : "quiet"} icon="stop" label="Cancel" onClick={onCancel} />
      ) : (
        onAgain && <Button icon="refresh" label="Run again" onClick={onAgain} />
      )}
    </div>
  );
}
