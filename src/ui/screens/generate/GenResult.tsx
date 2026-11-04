import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { plural } from "../../lib/format.ts";
import { duration } from "../../lib/jobs.ts";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

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
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  meta: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  grow: { flex: 1 },
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  line: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  muted: { margin: 0, fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.textMuted },
  skipped: { margin: 0, paddingInlineStart: space.s5, display: "flex", flexDirection: "column", gap: space.s2 },
  item: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
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
  onFoldAll?: (folded: boolean) => void;
};

function Head({
  badge,
  title,
  meta,
  actions,
}: {
  badge: ReactNode;
  title?: string;
  meta?: string;
  actions: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.head)}>
      {badge}
      {(title || meta) && (
        <div {...stylex.props(styles.titles)}>
          {title && <h2 {...stylex.props(styles.title)}>{title}</h2>}
          {meta && <span {...stylex.props(styles.meta)}>{meta}</span>}
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
  onFoldAll,
}: RunHeadProps) {
  if (!job) return null;
  const foldAll = count > 0 && onFoldAll && (
    <Button
      size="sm"
      variant="quiet"
      label={allFolded ? "Unfold all" : "Fold all"}
      onClick={() => onFoldAll(!allFolded)}
    />
  );
  if (job.status === "running")
    return (
      <div {...stylex.props(styles.body)}>
        <Head
          badge={<Badge tone="claude" busy label="Claude is writing" />}
          title={count ? `${plural(count, "test")} so far` : doing}
          meta={`${duration(job, now)} · ${plural(read, "passage")} read`}
          actions={
            <>
              {foldAll}
              <Button size="sm" icon="stop" label="Cancel" onClick={onCancel} />
            </>
          }
        />
        <Progress tone="claude" label="Generation" detail={doing} />
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
              <Button
                variant="primary"
                size="sm"
                iconAfter="arrow-right"
                label="Review these tests"
                onClick={onReview}
              />
            )}
          </>
        }
      />
    );
  return (
    <Head
      badge={
        job.status === "cancelled" ? (
          <Badge tone="neutral" icon="stop" label={`Cancelled${count ? ` · ${plural(count, "test")} kept` : ""}`} />
        ) : (
          <Badge tone="danger" icon="x-circle" label={result?.diagnosis?.title ?? "The generation stopped"} />
        )
      }
      actions={
        <>
          {foldAll}
          {left > 0 && onResume && (
            <Button
              variant="primary"
              size="sm"
              icon="generate"
              label={`Resume · ${plural(left, "test")} left`}
              onClick={onResume}
            />
          )}
          {count > 0 && <Button size="sm" iconAfter="arrow-right" label="Review these tests" onClick={onReview} />}
        </>
      }
    />
  );
}

export function GenSummary({ result, checked }: { result: GenOutput; checked: string }) {
  const skipped = result.skipped ?? [];
  return (
    <div {...stylex.props(styles.body)}>
      {checked && <p {...stylex.props(styles.line)}>{checked}</p>}
      {!!result.discarded?.length && (
        <p {...stylex.props(styles.muted)}>
          {plural(result.discarded.length, "test")} not validated yet {result.discarded.length === 1 ? "was" : "were"}{" "}
          deleted before this run.
        </p>
      )}
      {!result.reportFound && result.ok && (
        <p {...stylex.props(styles.muted)}>
          Claude did not say what it could not write a test for: read its reply in the log.
        </p>
      )}
      {skipped.length > 0 && (
        <Disclosure summary="Skipped" meta={plural(skipped.length, "item")} defaultOpen>
          <ul {...stylex.props(styles.skipped)}>
            {skipped.map((u) => (
              <li key={u.item} {...stylex.props(styles.line)}>
                <span {...stylex.props(styles.item)}>{u.item}</span> — {u.why}
              </li>
            ))}
          </ul>
        </Disclosure>
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
