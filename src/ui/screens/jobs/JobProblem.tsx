import * as stylex from "@stylexjs/stylex";
import type { Job, JobEvent } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { useApp } from "../../lib/app.ts";
import { failedStep, problemText } from "../../lib/jobs.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.s3 },
  body: { display: "flex", flexDirection: "column", gap: space.s2 },
  line: { margin: 0 },
  strong: { fontWeight: fontWeight.semibold },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  raw: {
    margin: 0,
    padding: space.s3,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.text,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
  },
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
  const app = useApp();
  const p = problemText(job, events);
  const step = failedStep(job);
  const steps = job.steps ?? [];
  return (
    <section aria-label="What went wrong" {...stylex.props(styles.section)}>
      <Banner tone={job.interrupted ? "warning" : "danger"} title={p.what}>
        <span {...stylex.props(styles.body)}>
          {p.why && <span {...stylex.props(styles.line)}>{p.why}</span>}
          {job.fix && (
            <span {...stylex.props(styles.line)}>
              <span {...stylex.props(styles.strong)}>What to do:</span> {job.fix}
            </span>
          )}
          {step && (
            <span {...stylex.props(styles.line)}>
              Step {steps.indexOf(step) + 1} of {steps.length} ·{" "}
              <span {...stylex.props(styles.strong)}>{step.label}</span>
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
            <Button size="sm" label="Open the system check" onClick={() => app.navigate("doctor")} />
          </span>
          <Disclosure
            summary="Technical details"
            quiet
            meta={p.repeated > 1 ? `same error ${p.repeated} times` : undefined}
          >
            <pre {...stylex.props(styles.raw)}>{p.detail}</pre>
          </Disclosure>
        </span>
      </Banner>
    </section>
  );
}
