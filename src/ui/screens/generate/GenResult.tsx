import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { DiagnosisText } from "../../components/claude/DiagnosisText.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { Timer } from "../../components/ui/Timer.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { duration } from "../../lib/jobs.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type SkippedItem, SkippedList } from "./SkippedList.tsx";

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenOutput = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks?: GenCheck[];
  changed: string[];
  discarded?: string[];
  skipped: SkippedItem[];
  reportFound: boolean;
  /** why a run's report could not be read, when one could not */
  reportErrors?: string[];
  durationMs: number;
  diagnosis?: { kind: string; title: string; detail: string };
  generation?: string;
  remaining?: number;
  /** gen.revise in mode change: the tests of the generation it changed */
  revised?: string[];
  /** planned: the job ended with the plan, nothing written (review) */
  state?: "planned";
};

const styles = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, flex: 1 },
  over: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.claudeText },
  spin: { display: "inline-flex", alignSelf: "flex-start", marginTop: space.s2, color: color.claude },
  titleRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3, minWidth: 0 },
  title: { margin: 0, color: color.text },
  meta: { color: color.textSubtle },
  grow: { flex: 1 },
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  line: { margin: 0, color: color.text },
  muted: { margin: 0, color: color.textMuted },
  fold: { alignSelf: "flex-end" },
});

const writingOf = (m: string) => m.match(/Writing (local-[0-9a-f]{8})/i)?.[1]?.toLowerCase();

export function landedIds(events: JobEvent[], result?: GenOutput | null): string[] {
  const ids: string[] = [];
  for (const e of events) {
    const id =
      e.type === "progress"
        ? writingOf(e.message)
        : e.type === "claude" && e.event.type === "tool" && /(^|_)tests_(save|edit)$/.test(e.event.name)
          ? e.event.input.match(/"id"\s*:\s*"(local-[0-9a-f]{8})"/i)?.[1]?.toLowerCase()
          : undefined;
    if (id && !ids.includes(id)) ids.push(id);
  }
  for (const id of [...(result?.tests ?? []), ...(result?.revised ?? [])]) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function passagesRead(events: JobEvent[]): number {
  let n = 0;
  for (const e of events)
    if (e.type === "progress") {
      const m = e.message.match(/Reading passages \((\d+)\)/);
      if (m) n = Math.max(n, Number(m[1]));
    }
  return n;
}

// a run that ended without doing what was asked: its head is the danger banner, which says why
export const failedRun = (job: Job, result: GenOutput | null) =>
  job.status !== "running" && job.status !== "cancelled" && !(job.status === "done" && result?.ok !== false);

export function checkLine(tests: string[], checks: GenCheck[] | undefined): string {
  if (!checks?.length) return "";
  const n = checks.filter((c) => c.errors + c.warnings > 0).length;
  return `All ${plural(tests.length, "test")} went through the check: ${n} ${n === 1 ? "has" : "have"} findings.`;
}

export type RunHeadProps = {
  job: Job | null;
  now: number;
  result: GenOutput | null;
  read: number;
  count: number;
  doing: string;
  left?: number;
  allFolded?: boolean;
  onCancel: () => void;
  onReview: () => void;
  /** the run's job, beside the screen */
  onOpenJob?: () => void;
  onResume?: () => void;
  /** run the failed job again with the input it kept (jobs.rerun) */
  onRetry?: () => void;
  onFoldAll?: (folded: boolean) => void;
};

function Head({
  badge,
  over,
  title,
  meta,
  actions,
}: {
  badge: ReactNode;
  over?: ReactNode;
  title?: string;
  meta?: string;
  actions: ReactNode;
}) {
  const lead = !!over || !title;
  return (
    <div {...stylex.props(styles.head)}>
      {lead && badge}
      {(title || meta) && (
        <div {...stylex.props(styles.titles)}>
          {over && <span {...stylex.props(type.small, type.medium, styles.over)}>{over}</span>}
          {title && (
            <span {...stylex.props(styles.titleRow)}>
              {!lead && badge}
              <h2 {...stylex.props(type.title, styles.title)}>{title}</h2>
            </span>
          )}
          {meta && <span {...stylex.props(type.small, styles.meta)}>{meta}</span>}
        </div>
      )}
      <span {...stylex.props(styles.grow)} />
      {actions}
    </div>
  );
}

export function RunHead({
  job,
  now,
  result,
  read,
  count,
  doing,
  left = 0,
  allFolded = false,
  onCancel,
  onReview,
  onOpenJob,
  onResume,
  onRetry,
  onFoldAll,
}: RunHeadProps) {
  if (!job) return null;
  const foldAll = onFoldAll && (
    <Button variant="quiet" label={allFolded ? "Unfold all" : "Fold all"} onClick={() => onFoldAll(!allFolded)} />
  );
  if (job.status === "running")
    return (
      <div {...stylex.props(styles.body)}>
        <Head
          badge={
            <span {...stylex.props(styles.spin)}>
              <Spinner />
            </span>
          }
          over={
            <>
              <Icon name="claude" size="sm" />
              <span>Claude is writing</span>
              {onOpenJob && (
                <>
                  ·
                  <Button variant="link" label="Open the job" onClick={onOpenJob} />
                </>
              )}
            </>
          }
          title={count ? `${plural(count, "test")} so far` : doing}
          meta={`${plural(read, "passage")} read`}
          actions={
            <>
              <Timer seconds={Math.round((now - Date.parse(job.startedAt)) / 1000)} />
              {foldAll}
              <Button variant="quiet" icon="stop" label="Cancel" onClick={onCancel} />
            </>
          }
        />
        <Progress tone="claude" label="Generation" detail={count ? doing : undefined} />
      </div>
    );
  if (job.status === "done" && result?.ok !== false)
    return (
      <Head
        badge={<Badge tone="success" icon="check-circle" label="Done" />}
        title={`${plural(count, "test")} ${result?.revised?.length && !result.tests.length ? "changed" : "written"}`}
        meta={`in ${duration(job, now)} · ${plural(read, "passage")} read`}
        actions={
          <>
            {foldAll}
            {count > 0 && (
              <Button variant="primary" iconAfter="arrow-right" label="Review these tests" onClick={onReview} />
            )}
          </>
        }
      />
    );
  const resume = (s: "sm" | "md") =>
    left > 0 &&
    onResume && (
      <Button
        variant="primary"
        size={s}
        icon="generate"
        label={`Resume · ${plural(left, "test")} left`}
        onClick={onResume}
      />
    );
  const review = (s: "sm" | "md") =>
    count > 0 && <Button size={s} iconAfter="arrow-right" label="Review these tests" onClick={onReview} />;
  if (failedRun(job, result))
    return (
      <div {...stylex.props(styles.body)}>
        <Banner
          tone="danger"
          title={result?.diagnosis?.title ?? "The generation stopped"}
          actions={
            <>
              {resume("sm") ||
                (onRetry && <Button variant="claude" size="sm" icon="refresh" label="Run again" onClick={onRetry} />)}
              {review("sm")}
            </>
          }
        >
          {result?.diagnosis?.detail ? <DiagnosisText text={result.diagnosis.detail} /> : job.error}
        </Banner>
        {result?.diagnosis?.detail && job.error && (
          <Disclosure summary="Technical details" quiet>
            <Raw text={job.error} />
          </Disclosure>
        )}
        {foldAll && <span {...stylex.props(styles.fold)}>{foldAll}</span>}
      </div>
    );
  return (
    <Head
      badge={<Badge tone="neutral" icon="stop" label={`Cancelled${count ? ` · ${plural(count, "test")} kept` : ""}`} />}
      actions={
        <>
          {foldAll}
          {resume("md")}
          {review("md")}
        </>
      }
    />
  );
}

export function GenSummary({
  result,
  checked,
  onOpenJob,
  open,
  onOpenChange,
}: {
  result: GenOutput;
  checked: string;
  /** the run's job, beside the screen */
  onOpenJob?: () => void;
  /** the not-covered list, folded with the rest by the screen's « Fold all » */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const skipped = result.skipped ?? [];
  return (
    <div {...stylex.props(styles.body)}>
      {checked && <p {...stylex.props(type.body, styles.line)}>{checked}</p>}
      {!!result.discarded?.length && (
        <p {...stylex.props(type.compact, styles.muted)}>
          {plural(result.discarded.length, "test")} not validated yet {result.discarded.length === 1 ? "was" : "were"}{" "}
          deleted before this run.
        </p>
      )}
      {!result.reportFound && result.ok && (
        <div {...stylex.props(styles.body)}>
          <Banner
            tone="danger"
            title="A run's report could not be read"
            actions={
              onOpenJob && <Button size="sm" variant="quiet" icon="jobs" label="Show the job" onClick={onOpenJob} />
            }
          >
            Claude was asked again and its report still could not be read: what that run left without a test is not
            known{skipped.length > 0 ? ", and the list below may miss some" : ""}. Ask the generation again to get it.
          </Banner>
          {!!result.reportErrors?.length && (
            <Disclosure summary="Why it could not be read" quiet>
              <Raw text={result.reportErrors.join("\n")} label="Why the report could not be read" />
            </Disclosure>
          )}
        </div>
      )}
      {skipped.length > 0 && <SkippedList skipped={skipped} open={open} onOpenChange={onOpenChange} />}
      {result.changed.length > 0 && (
        <Banner
          tone="warning"
          compact
          actions={
            onOpenJob && <Button size="sm" variant="quiet" icon="jobs" label="Show the job" onClick={onOpenJob} />
          }
        >
          Claude also changed {plural(result.changed.length, "existing test")}: {result.changed.join(", ")} — revert it
          from the Claude panel.
        </Banner>
      )}
    </div>
  );
}
