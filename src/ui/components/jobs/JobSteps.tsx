import * as stylex from "@stylexjs/stylex";
import type { Job, JobEvent, JobStep } from "../../../core/types.ts";
import { clock, duration, kindLabel, logLines, resultLine } from "../../lib/jobs.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Progress } from "../ui/Progress.tsx";
import { Raw } from "../ui/Raw.tsx";
import { Timeline } from "../ui/Timeline.tsx";
import { type } from "../ui/type.ts";
import { stepState } from "./kinds.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  msg: { color: color.textMuted },
  child: { alignSelf: "flex-start" },
});

const WORD: Record<JobStep["status"], string> = {
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  skipped: "Not needed",
};

function when(s: JobStep, job: Job, now: number): { time?: string; note?: string } {
  if (s.status === "waiting") return { note: job.status === "running" ? WORD.waiting : "Not started" };
  if (s.status === "skipped" || s.status === "cancelled") return { note: WORD[s.status] };
  return s.startedAt
    ? { time: duration({ startedAt: s.startedAt, endedAt: s.endedAt }, now) }
    : { note: WORD[s.status] };
}

export function JobSteps({
  job,
  events,
  byId,
  now,
  onOpen,
}: {
  job: Job;
  events: JobEvent[];
  byId: Map<string, Job>;
  now: number;
  onOpen(id: string): void;
}) {
  const names = useTestNames();
  return (
    <Timeline
      label="Steps"
      items={(job.steps ?? []).map((s) => {
        const child = s.jobId ? byId.get(s.jobId) : undefined;
        const tail =
          s.status === "running" || s.status === "failed"
            ? logLines(events.filter((e) => "step" in e && e.step === s.id && e.type !== "progress")).slice(-4)
            : [];
        const pct = s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null;
        const state = s.status === "failed" && job.interrupted ? "waiting" : stepState(s.status);
        const body = (
          <div key={s.id} {...stylex.props(styles.body)}>
            {s.status === "running" && pct !== null && (
              <Progress
                label={`${s.label} progress`}
                value={pct}
                detail={`${s.message ? `${nameTests(s.message, names)} · ` : ""}${s.done ?? 0} of ${s.total}`}
              />
            )}
            {s.status === "running" && pct === null && s.message && (
              <span {...stylex.props(type.small, styles.msg)}>{nameTests(s.message, names)}</span>
            )}
            {s.status !== "running" && s.total ? (
              <span {...stylex.props(type.small, styles.msg)}>
                {s.done ?? 0} of {s.total}
              </span>
            ) : null}
            {child && (
              <span {...stylex.props(styles.child)}>
                <Button
                  variant="quiet"
                  size="sm"
                  icon="jobs"
                  label={`${kindLabel(child.kind)} · a job of its own · ${child.status === "running" ? "running" : resultLine(child).toLowerCase()}`}
                  onClick={() => onOpen(child.id)}
                />
              </span>
            )}
            {tail.length > 0 && (
              <Raw
                lines={tail.map((l) => ({ text: nameTests(l.text, names), level: l.level, at: clock(l.at) }))}
                label={`Log of ${s.label}`}
              />
            )}
          </div>
        );
        const has = s.status === "running" || !!s.total || !!child || tail.length > 0;
        return { key: s.id, state, title: s.label, ...when(s, job, now), children: has ? body : undefined };
      })}
    />
  );
}
