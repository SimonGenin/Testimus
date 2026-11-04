import * as stylex from "@stylexjs/stylex";
import type { Job, JobEvent, JobProcess, JobStep } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Timeline } from "../../components/ui/Timeline.tsx";
import { duration, kindLabel, logLines, processLabel, resultLine } from "../../lib/jobs.ts";
import { border, color, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { LogLines } from "./JobFullLog.tsx";
import { stepState } from "./kinds.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  msg: { color: color.textMuted, fontSize: fontSize.small, lineHeight: lineHeight.small },
  procs: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  proc: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    color: color.text,
  },
  claude: { color: color.claudeText },
  grow: { flex: 1, minWidth: 0 },
  small: { color: color.textMuted, fontSize: fontSize.small, lineHeight: lineHeight.small },
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

function Proc({ p, now }: { p: JobProcess; now: number }) {
  const claude = p.label.startsWith("Claude");
  return (
    <li {...stylex.props(styles.proc)}>
      <span {...stylex.props(claude && styles.claude)}>
        <Icon name={claude ? "claude" : "terminal"} size="sm" />
      </span>
      <span {...stylex.props(styles.grow)}>{processLabel(p.label)}</span>
      <span {...stylex.props(styles.small)}>
        {p.pid ? `pid ${p.pid} · ` : ""}
        {!p.endedAt ? "running" : p.exit === 0 ? "ended" : `exited ${p.exit ?? "?"}`} ·{" "}
        {duration({ startedAt: p.startedAt, endedAt: p.endedAt }, now)}
      </span>
    </li>
  );
}

export function JobProcesses({ list, now, label = "Processes" }: { list: JobProcess[]; now: number; label?: string }) {
  return (
    <ul aria-label={label} {...stylex.props(styles.procs)}>
      {list.map((p) => (
        <Proc key={p.id} p={p} now={now} />
      ))}
    </ul>
  );
}

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
  const procs = job.processes ?? [];
  return (
    <Timeline
      label="Steps"
      items={(job.steps ?? []).map((s) => {
        const child = s.jobId ? byId.get(s.jobId) : undefined;
        const mine = procs.filter((p) => p.step === s.id);
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
                detail={`${s.message ? `${s.message} · ` : ""}${s.done ?? 0} of ${s.total}`}
              />
            )}
            {s.status === "running" && pct === null && s.message && (
              <span {...stylex.props(styles.msg)}>{s.message}</span>
            )}
            {s.status !== "running" && s.total ? (
              <span {...stylex.props(styles.msg)}>
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
            {mine.length > 0 && <JobProcesses list={mine} now={now} label={`Processes of ${s.label}`} />}
            {tail.length > 0 && <LogLines lines={tail} />}
          </div>
        );
        const has = s.status === "running" || !!s.total || !!child || mine.length > 0 || tail.length > 0;
        return { key: s.id, state, title: s.label, ...when(s, job, now), children: has ? body : undefined };
      })}
    />
  );
}
