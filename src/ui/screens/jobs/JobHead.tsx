import * as stylex from "@stylexjs/stylex";
import type { Job } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { clock, duration, kindLabel, resultLine } from "../../lib/jobs.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { KindTile } from "./JobState.tsx";
import { iconOf, toneOf } from "./kinds.ts";

const styles = stylex.create({
  head: { display: "flex", alignItems: "flex-start", gap: space.s3 },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  title: { margin: 0, color: color.text },
  subject: { color: color.textMuted, overflowWrap: "anywhere" },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    color: color.textMuted,
  },
  mono: { color: color.text },
  link: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

const WHY: Record<string, string> = {
  "after-failure": "After the failure of",
  "follow-up": "Follow-up of",
  retry: "Run again from",
};

export function JobHead({
  job,
  subject,
  byId,
  now,
  onCancel,
  onAgain,
  onOpen,
}: {
  job: Job;
  subject: string;
  byId: Map<string, Job>;
  now: number;
  onCancel: () => void;
  onAgain?: () => void;
  onOpen: (id: string) => void;
}) {
  const origin = job.cause ? byId.get(job.cause.jobId) : undefined;
  const parent = job.parentId ? byId.get(job.parentId) : undefined;
  const running = job.status === "running";
  return (
    <>
      <div {...stylex.props(styles.head)}>
        <KindTile kind={job.kind} size="lg" />
        <div {...stylex.props(styles.titles)}>
          <h2 {...stylex.props(type.title, styles.title)}>{kindLabel(job.kind)}</h2>
          {subject && <span {...stylex.props(type.compact, styles.subject)}>{subject}</span>}
        </div>
        {running ? (
          <Button variant="quiet" icon="stop" label="Cancel" onClick={onCancel} />
        ) : (
          onAgain && <Button icon="refresh" label="Run again" onClick={onAgain} />
        )}
      </div>
      <div {...stylex.props(type.small, styles.meta)}>
        {running ? (
          <Badge label="Running" tone="info" busy />
        ) : (
          <Badge label={resultLine(job).split(" · ")[0]} tone={toneOf(job)} icon={iconOf(job)} />
        )}
        <span {...stylex.props(type.code, styles.mono)}>{duration(job, now)}</span>
        <span>
          {running ? "started " : ""}
          {clock(job.startedAt)}
          {job.endedAt ? ` → ${clock(job.endedAt)}` : ""}
        </span>
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
    </>
  );
}
