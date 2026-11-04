import * as stylex from "@stylexjs/stylex";
import type { Job, JobEvent, JobProcess, JobStep } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { Timeline } from "../../components/ui/Timeline.tsx";
import { type } from "../../components/ui/type.ts";
import { clock, duration, kindLabel, logLines, processLabel, resultLine } from "../../lib/jobs.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { stepState } from "./kinds.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  msg: { color: color.textMuted },
  claude: { display: "inline-flex", color: color.claudeText },
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

const procState = (p: JobProcess, now: number) =>
  `${p.pid ? `pid ${p.pid} · ` : ""}${!p.endedAt ? "running" : p.exit === 0 ? "ended" : `exited ${p.exit ?? "?"}`} · ${duration({ startedAt: p.startedAt, endedAt: p.endedAt }, now)}`;

export function JobProcesses({ list, now, label = "Processes" }: { list: JobProcess[]; now: number; label?: string }) {
  return (
    <List<JobProcess>
      label={label}
      selection="none"
      divided
      items={list}
      getKey={(p) => p.id}
      renderItem={(p) => ({
        lead: p.label.startsWith("Claude") ? (
          <span {...stylex.props(styles.claude)}>
            <Icon name="terminal" size="sm" />
          </span>
        ) : (
          <Icon name="terminal" size="sm" />
        ),
        title: processLabel(p.label),
        trail: procState(p, now),
      })}
    />
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
              <span {...stylex.props(type.small, styles.msg)}>{s.message}</span>
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
            {mine.length > 0 && <JobProcesses list={mine} now={now} label={`Processes of ${s.label}`} />}
            {tail.length > 0 && (
              <Raw
                lines={tail.map((l) => ({ text: l.text, level: l.level, at: clock(l.at) }))}
                label={`Log of ${s.label}`}
              />
            )}
          </div>
        );
        const has = s.status === "running" || !!s.total || !!child || mine.length > 0 || tail.length > 0;
        return { key: s.id, state, title: s.label, ...when(s, job, now), children: has ? body : undefined };
      })}
    />
  );
}
