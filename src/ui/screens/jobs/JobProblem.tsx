import { useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { Button, Icon } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { failedStep, problemText } from "../../lib/jobs.ts";
import { stepTone } from "./JobState.tsx";

export function JobProblem({
  job,
  events,
  diagnosis,
  onRetry,
  onOpen,
}: {
  job: Job;
  events: JobEvent[];
  diagnosis?: Job;
  onRetry?: () => void;
  onOpen(id: string): void;
}) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const p = problemText(job, events);
  const step = failedStep(job);
  const steps = job.steps ?? [];
  const warn = !!job.interrupted;
  return (
    <section className={cx("jp", warn && "jp-warn")} role="alert" aria-label="What went wrong">
      <div className="jp-what">
        <div className="jp-kicker">What happened</div>
        <div className="jp-title">{p.what}</div>
        {p.why && <p>{p.why}</p>}
        {job.fix && (
          <p>
            <strong>What to do:</strong> {job.fix}
          </p>
        )}
      </div>
      {step && (
        <div className="jp-where">
          <div className="jp-kicker">Where</div>
          <div>
            Step {steps.indexOf(step) + 1} of {steps.length} · <strong>{step.label}</strong>
            {step.total ? ` · stopped at ${step.done ?? 0} of ${step.total}` : ""}
          </div>
          <div className="jp-strip" aria-hidden="true">
            {steps.map((s) => (
              <span key={s.id} className={cx("jp-seg", `t-${stepTone(s.status, job.interrupted)}`)}>
                <span className="jp-segbar" />
                <span className="jp-seglabel">{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="jp-actions">
        {diagnosis && (
          <Button size="sm" tone="primary" onClick={() => onOpen(diagnosis.id)}>
            Open the diagnosis
          </Button>
        )}
        {onRetry && (
          <Button size="sm" tone={diagnosis ? undefined : "primary"} icon="revert" onClick={onRetry}>
            Run again
          </Button>
        )}
        <Button size="sm" onClick={() => app.navigate("doctor")}>
          Open the system check
        </Button>
      </div>
      <div className="jp-tech">
        <button type="button" className="jp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "down" : "right"} size={14} />
          Technical details
          {p.repeated > 1 && <span className="muted jp-count">same error {p.repeated} times</span>}
        </button>
        {open && <pre className="log jp-raw">{p.detail}</pre>}
      </div>
    </section>
  );
}
