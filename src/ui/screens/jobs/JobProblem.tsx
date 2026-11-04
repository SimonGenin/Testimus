import * as stylex from "@stylexjs/stylex";
import type { Job, JobEvent } from "../../../core/types.ts";
import { ProblemPlace, problemOf } from "../../components/shell/ProblemPanel.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { type } from "../../components/ui/type.ts";
import { failedStep, problemText } from "../../lib/jobs.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.s3 },
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  line: { margin: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

// ponytail: a failure said three ways — what in plain words with what to do, where it stopped, the raw text folded
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
  const p = problemText(job, events);
  const jira = job.kind === "pull" || job.kind === "push" ? "Jira " : "";
  const access = problemOf(`${jira}${job.error ?? ""} ${job.fix ?? ""}`).access;
  const step = failedStep(job);
  const steps = job.steps ?? [];
  return (
    <section aria-label="What went wrong" {...stylex.props(styles.section)}>
      <Banner tone={job.interrupted ? "warning" : "danger"} title={p.what}>
        <span {...stylex.props(styles.body)}>
          {p.why && <span {...stylex.props(styles.line)}>{p.why}</span>}
          {job.fix && (
            <span {...stylex.props(styles.line)}>
              <span {...stylex.props(type.strong)}>What to do:</span> {job.fix}
            </span>
          )}
          {step && (
            <span {...stylex.props(styles.line)}>
              Step {steps.indexOf(step) + 1} of {steps.length} ·{" "}
              <span {...stylex.props(type.strong)}>{step.label}</span>
              {step.total ? ` · stopped at ${step.done ?? 0} of ${step.total}` : ""}
            </span>
          )}
          <span {...stylex.props(styles.actions)}>
            {diagnosis && (
              <Button size="sm" variant="primary" label="Open the diagnosis" onClick={() => onOpen(diagnosis.id)} />
            )}
            {onRetry && (
              <Button
                size="sm"
                variant={diagnosis ? "secondary" : "primary"}
                icon="refresh"
                label="Run again"
                onClick={onRetry}
              />
            )}
            <ProblemPlace access={access} />
          </span>
          <Disclosure
            summary="Technical details"
            quiet
            meta={p.repeated > 1 ? `same error ${p.repeated} times` : undefined}
          >
            <Raw text={p.detail} label="Technical details" />
          </Disclosure>
        </span>
      </Banner>
    </section>
  );
}
