import { useState } from "react";
import type { CheckFile, Job, JobEvent, LocalTestRef, Review, Source, Test, XrayJson } from "../../../core/types.ts";
import { fileUrl } from "../../api.ts";
import { Button, FindingCard, Icon, ReviewBadge, Severity, Skeleton } from "../../components/ui/index.ts";
import { plural } from "../../lib/format.ts";
import { duration } from "../../lib/jobs.ts";
import { FindingSources, ReviewStep } from "../review/ReviewStep.tsx";

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

export type Landed = { id: string; test?: Test; ref?: LocalTestRef; check?: CheckFile | null };

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

function Findings({ refItem, check, checking }: { refItem?: LocalTestRef; check?: GenCheck; checking: boolean }) {
  if (check) {
    if (check.errors) return <Severity tone="error">{plural(check.errors, "error")}</Severity>;
    if (check.warnings) return <Severity tone="warning">{plural(check.warnings, "warning")}</Severity>;
    return <Severity tone="ok">No findings</Severity>;
  }
  const f = refItem?.findings;
  if (!f) return checking ? <span className="muted">Checking…</span> : <span className="muted">Not checked yet</span>;
  if (f.errors) return <Severity tone={f.stale ? "stale" : "error"}>{plural(f.errors, "error")}</Severity>;
  if (f.warnings) return <Severity tone={f.stale ? "stale" : "warning"}>{plural(f.warnings, "warning")}</Severity>;
  return <Severity tone="ok">No findings</Severity>;
}

export function GenCard({
  item,
  check,
  writing,
  checking,
  xray,
  open,
  onToggle,
  onOpen,
  onSource,
}: {
  item: Landed;
  check?: GenCheck;
  writing: boolean;
  checking: boolean;
  xray: XrayJson;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onSource: (s: Source) => void;
}) {
  const [folded, setFolded] = useState<Set<number>>(new Set());
  if (!item.test)
    return (
      <div
        className="gcard gcard-wait"
        role="status"
        aria-busy="true"
        aria-label={writing ? "Claude is writing a test" : "Loading a test"}
      >
        <span className="gcard-title muted">{writing ? "Writing…" : "Loading…"}</span>
        <Skeleton w={70} h={12} />
        <span className="gcard-meta">
          <Skeleton w={160} h={12} />
        </span>
        <Skeleton w={70} h={20} r={10} />
      </div>
    );
  const test = item.test;
  const title = test.summary || "Untitled test";
  const findings = item.check?.findings ?? [];
  const stale = !!item.ref?.findings?.stale;
  const url = (file: string) => fileUrl(`tests/${item.id}/${file}`);
  const fold = (i: number, f: boolean) =>
    setFolded((cur) => {
      const next = new Set(cur);
      if (f) next.add(i);
      else next.delete(i);
      return next;
    });
  return (
    <section className="gcard" aria-label={title}>
      <div className="gcard-head">
        <button type="button" className="gcard-toggle" aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? "down" : "right"} />
          <span className="gcard-title">{title}</span>
        </button>
        <span className="muted">{plural(test.steps.length, "step")}</span>
        <Findings refItem={item.ref} check={check} checking={checking} />
        <ReviewBadge review={(check?.review ?? item.ref?.review ?? test.review) as Review} small />
        <Button size="sm" tone="quiet" icon="right" onClick={onOpen}>
          Open in Review
        </Button>
      </div>
      {open && (
        <div className="gcard-body">
          {findings
            .filter((f) => !f.step || f.step > test.steps.length)
            .map((f, i) => (
              <FindingCard key={i} finding={f} stale={stale} scope="Whole test">
                <FindingSources finding={f} selected="" onSelect={onSource} />
              </FindingCard>
            ))}
          {test.steps.map((s, i) => (
            <ReviewStep
              key={i}
              n={i + 1}
              step={s}
              xray={xray}
              findings={findings.filter((f) => f.step === i + 1)}
              stale={stale}
              folded={folded.has(i)}
              active={false}
              selected=""
              url={url}
              onFold={(f) => fold(i, f)}
              onSelect={(s) => onSource(s)}
              onOpenImage={(file) => window.open(url(file), "_blank")}
            />
          ))}
          {!test.steps.length && <p className="muted">This test has no steps yet.</p>}
        </div>
      )}
    </section>
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
}: {
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
}) {
  if (!job) return null;
  const foldAll = count > 0 && onFoldAll && (
    <Button size="sm" tone="quiet" onClick={() => onFoldAll(!allFolded)}>
      {allFolded ? "Unfold all" : "Fold all"}
    </Button>
  );
  if (job.status === "running")
    return (
      <div className="genhead">
        <span className="sev s-run">
          <span className="dot run-dot" />
          Claude is writing
        </span>
        <h2 className="h genhead-title">{count ? `${plural(count, "test")} so far` : doing}</h2>
        <span className="muted">
          {duration(job, now)} · {plural(read, "passage")} read
        </span>
        <span className="spacer" />
        {foldAll}
        <Button icon="stop" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  if (job.status === "done" && result?.ok !== false)
    return (
      <div className="genhead">
        <Severity tone="ok">Done</Severity>
        <h2 className="h genhead-title">{plural(count, "test")} written</h2>
        <span className="muted">
          in {duration(job, now)} · {plural(read, "passage")} read
        </span>
        <span className="spacer" />
        {foldAll}
        {count > 0 && (
          <Button tone="primary" icon="right" onClick={onReview}>
            Review these tests
          </Button>
        )}
      </div>
    );
  return (
    <div className="genhead">
      {job.status === "cancelled" ? (
        <span className="sev s-stop">Cancelled{count ? ` · ${plural(count, "test")} kept` : ""}</span>
      ) : (
        <Severity tone="error">{result?.diagnosis?.title ?? "The generation stopped"}</Severity>
      )}
      <span className="spacer" />
      {foldAll}
      {left > 0 && onResume && (
        <Button tone="primary" icon="generate" onClick={onResume}>
          Resume · {plural(left, "test")} left
        </Button>
      )}
      {count > 0 && (
        <Button icon="right" onClick={onReview}>
          Review these tests
        </Button>
      )}
    </div>
  );
}

export function GenSummary({ result, checked }: { result: GenOutput; checked: string }) {
  return (
    <>
      <p>{checked}</p>
      {!!result.discarded?.length && (
        <p className="muted">
          {plural(result.discarded.length, "test")} not validated yet {result.discarded.length === 1 ? "was" : "were"}{" "}
          deleted before this run.
        </p>
      )}
      {!result.reportFound && result.ok && (
        <p className="muted">Claude did not say what it could not write a test for: read its reply in the log.</p>
      )}
      {(result.skipped ?? []).map((u) => (
        <div key={u.item} className="gen-skipped">
          <Severity tone="warning">Skipped</Severity>
          <p>
            <span className="mono">{u.item}</span> — {u.why}
          </p>
        </div>
      ))}
      {result.changed.length > 0 && (
        <p className="sev s-warn">
          Claude also changed {plural(result.changed.length, "existing test")}: {result.changed.join(", ")} — revert it
          from the Claude panel or Jobs.
        </p>
      )}
    </>
  );
}
