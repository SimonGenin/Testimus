import type { Job, JobEvent, LocalTestRef, Review, Test } from "../../../core/types.ts";
import { Button, ReviewBadge, Severity, Skeleton } from "../../components/ui/index.ts";
import { plural } from "../../lib/format.ts";
import { duration } from "../../lib/jobs.ts";

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenOutput = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks?: GenCheck[];
  changed: string[];
  uncovered: { item: string; why: string }[];
  reportFound: boolean;
  durationMs: number;
  diagnosis?: { kind: string; title: string; detail: string };
};

export type Landed = { id: string; test?: Test; ref?: LocalTestRef };

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
  onOpen,
}: {
  item: Landed;
  check?: GenCheck;
  writing: boolean;
  checking: boolean;
  onOpen: () => void;
}) {
  if (!item.test)
    return (
      <div
        className="gcard"
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
  return (
    <button type="button" className="gcard" onClick={onOpen}>
      <span className="gcard-title">{item.test.summary || "Untitled test"}</span>
      <Findings refItem={item.ref} check={check} checking={checking} />
      <span className="gcard-meta">
        <span className="muted">{plural(item.test.steps.length, "step")}</span>
      </span>
      <ReviewBadge review={(check?.review ?? item.ref?.review ?? item.test.review) as Review} small />
    </button>
  );
}

export function RunHead({
  job,
  now,
  result,
  read,
  count,
  doing,
  onCancel,
  onReview,
}: {
  job: Job | null;
  now: number;
  result: GenOutput | null;
  read: number;
  count: number;
  doing: string;
  onCancel: () => void;
  onReview: () => void;
}) {
  if (!job) return null;
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
      {count > 0 && (
        <Button icon="right" onClick={onReview}>
          Review these tests
        </Button>
      )}
    </div>
  );
}

export function Coverage({
  asked,
  result,
  checked,
}: {
  asked: { label: string; ids: string[] }[];
  result: GenOutput;
  checked: string;
}) {
  const covered = (ids: string[]) => ids.filter((r) => !result.uncovered.some((u) => u.item.includes(r))).length;
  return (
    <>
      <p>
        {asked.map((a) => (
          <strong key={a.label}>
            {covered(a.ids)} of {plural(a.ids.length, `${a.label.toLowerCase()} id`)} covered.{" "}
          </strong>
        ))}
        {checked}
      </p>
      {!result.reportFound && result.ok && (
        <p className="muted">Claude did not say what it could not cover: read its reply in the log.</p>
      )}
      {result.uncovered.map((u) => (
        <div key={u.item} className="uncovered">
          <Severity tone="warning">Not covered</Severity>
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
