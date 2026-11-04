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

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenOutput = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks?: GenCheck[];
  changed: string[];
  discarded?: string[];
  skipped: { item: string; why: string }[];
  reportFound: boolean;
  durationMs: number;
  diagnosis?: { kind: string; title: string; detail: string };
  generation?: string;
  remaining?: number;
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
  cov: { display: "flex", flexDirection: "column", gap: space.s2 },
  caption: { margin: 0, color: color.textMuted },
  skipped: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s2 },
  no: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  noIcon: { display: "inline-flex", flex: "none", marginTop: space.s1, color: color.warning },
  noBody: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  why: { color: color.textMuted },
  item: { overflowWrap: "anywhere" },
  fold: { alignSelf: "flex-end" },
});

const ID = /^(?=.*[\d_])[\w.#-]+$/;

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
  for (const id of result?.tests ?? []) if (!ids.includes(id)) ids.push(id);
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
  onResume?: () => void;
  /** start the same generation again (a run that stopped before its plan) */
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
  onResume,
  onRetry,
  onFoldAll,
}: RunHeadProps) {
  if (!job) return null;
  const foldAll = count > 0 && onFoldAll && (
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
              <span>Claude is writing</span>·<span {...stylex.props(type.code)}>{job.id}</span>
            </>
          }
          title={count ? `${plural(count, "test")} so far` : doing}
          meta={`${plural(read, "passage")} read`}
          actions={
            <>
              <Timer seconds={Math.round((now - Date.parse(job.startedAt)) / 1000)} />
              {foldAll}
              <Button icon="stop" label="Cancel" onClick={onCancel} />
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
        title={`${plural(count, "test")} written`}
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
                (onRetry && <Button variant="claude" size="sm" icon="refresh" label="Try again" onClick={onRetry} />)}
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

export function GenSummary({ result, checked }: { result: GenOutput; checked: string }) {
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
        <p {...stylex.props(type.compact, styles.muted)}>
          Claude did not say what it could not write a test for: read its reply in the log.
        </p>
      )}
      {skipped.length > 0 && (
        <section aria-labelledby="gen-not-covered" {...stylex.props(styles.cov)}>
          <h3 id="gen-not-covered" {...stylex.props(type.caption, styles.caption)}>
            Not covered · {skipped.length} — and why
          </h3>
          <ul {...stylex.props(type.compact, styles.skipped)}>
            {skipped.map((u) => (
              <li key={u.item} {...stylex.props(styles.no)}>
                <span {...stylex.props(styles.noIcon)}>
                  <Icon name="alert-triangle" size="sm" />
                </span>
                <span {...stylex.props(styles.noBody)}>
                  <span {...stylex.props(ID.test(u.item) ? type.code : type.compact, styles.item)}>{u.item}</span>
                  <span {...stylex.props(styles.why)}>{u.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.changed.length > 0 && (
        <Banner tone="warning" compact>
          Claude also changed {plural(result.changed.length, "existing test")}: {result.changed.join(", ")} — revert it
          from the Claude panel or Jobs.
        </Banner>
      )}
    </div>
  );
}
