import type { Job, JobEvent, JobProcess, JobStep } from "../../../core/types.ts";
import { cx } from "../../lib/format.ts";
import { clock, duration, kindLabel, logLines, processLabel, resultLine } from "../../lib/jobs.ts";
import { StateIcon, stepTone } from "./JobState.tsx";

const WORD: Record<JobStep["status"], string> = {
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  skipped: "Not needed",
};

function Proc({ p, now }: { p: JobProcess; now: number }) {
  const tone = !p.endedAt ? "run" : p.exit === 0 ? "ok" : "err";
  return (
    <li className="js-proc">
      <span className={cx("js-pdot", `t-${tone}`)} aria-hidden="true" />
      <span className="js-plabel">{processLabel(p.label)}</span>
      <span className="muted">
        {p.pid ? `pid ${p.pid} · ` : ""}
        {!p.endedAt ? "running" : p.exit === 0 ? "ended" : `ended with code ${p.exit ?? "?"}`} ·{" "}
        {duration({ startedAt: p.startedAt, endedAt: p.endedAt }, now)}
      </span>
    </li>
  );
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
  const steps = job.steps ?? [];
  const procs = job.processes ?? [];
  return (
    <ol className="js" aria-label="Steps">
      {steps.map((s, i) => {
        const tone = stepTone(s.status, job.interrupted);
        const child = s.jobId ? byId.get(s.jobId) : undefined;
        const mine = procs.filter((p) => p.step === s.id);
        const tail =
          s.status === "running" || s.status === "failed"
            ? logLines(events.filter((e) => "step" in e && e.step === s.id && e.type !== "progress")).slice(-4)
            : [];
        const pct = s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null;
        return (
          <li key={s.id} className={cx("js-step", `t-${tone}`, s.status === "running" && "js-on")}>
            <span className="js-mark" aria-hidden="true">
              {tone === "wait" ? i + 1 : <StateIcon tone={tone} />}
            </span>
            <div className="js-body">
              <div className="js-head">
                <span className="js-label">{s.label}</span>
                <span className="muted js-when">
                  {s.status === "waiting" && job.status !== "running"
                    ? "Not started"
                    : s.status === "waiting" || s.status === "skipped"
                      ? WORD[s.status]
                      : s.startedAt
                        ? duration({ startedAt: s.startedAt, endedAt: s.endedAt }, now)
                        : WORD[s.status]}
                </span>
              </div>
              {s.status === "running" && (
                <>
                  {pct !== null && (
                    <div
                      className="prog js-bar"
                      role="progressbar"
                      aria-label={`${s.label} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                    >
                      <span className="jt-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {(s.message || s.total) && (
                    <div className="js-msg">
                      {s.message}
                      {s.total ? (
                        <span className="muted">
                          {" "}
                          · {s.done ?? 0} of {s.total}
                        </span>
                      ) : null}
                    </div>
                  )}
                </>
              )}
              {s.status !== "running" && s.total ? (
                <div className="muted js-msg">
                  {s.done ?? 0} of {s.total}
                </div>
              ) : null}
              {child && (
                <button type="button" className="js-child" onClick={() => onOpen(child.id)}>
                  <span>{kindLabel(child.kind)}</span>
                  <span className="muted">
                    a job of its own · {child.status === "running" ? "running" : resultLine(child).toLowerCase()}
                  </span>
                </button>
              )}
              {mine.length > 0 && (
                <ul className="js-procs" aria-label={`Processes of ${s.label}`}>
                  {mine.map((p) => (
                    <Proc key={p.id} p={p} now={now} />
                  ))}
                </ul>
              )}
              {tail.length > 0 && (
                <div className="log js-tail">
                  {tail.map((l, k) => (
                    <div key={k} className={cx(l.level === "warn" && "log-warn", l.level === "error" && "log-error")}>
                      <span className="log-at">{clock(l.at)}</span>
                      {l.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function JobProcesses({ list, now }: { list: JobProcess[]; now: number }) {
  return (
    <ul className="js-procs js-procs-all" aria-label="Processes">
      {list.map((p) => (
        <Proc key={p.id} p={p} now={now} />
      ))}
    </ul>
  );
}
