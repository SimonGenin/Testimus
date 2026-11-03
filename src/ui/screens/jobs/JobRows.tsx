import type { CSSProperties, ReactNode } from "react";
import type { Job, JobProcess } from "../../../core/types.ts";
import { Icon } from "../../components/legacy/index.ts";
import { cx, plural } from "../../lib/format.ts";
import {
  childSummary,
  clock,
  duration,
  failedStep,
  type JobNode,
  kindLabel,
  percent,
  problemText,
  processLabel,
  resultLine,
  subjectLabel,
} from "../../lib/jobs.ts";
import { KindTile, StateIcon, stepTone, toneOf } from "./JobState.tsx";

const CAUSE: Record<string, string> = {
  "after-failure": "After the failure",
  "follow-up": "Follow-up",
  retry: "Run again",
};

export type RowCtx = {
  byId: Map<string, Job>;
  activeId: string;
  now: number;
  isOpen(n: JobNode): boolean;
  toggle(id: string, open: boolean): void;
  pick(id: string): void;
};

function inside(n: JobNode): string {
  const k = n.children.length + n.after.length;
  const p = n.job.processes?.length ?? 0;
  return [k ? plural(k, "job") : "", p === 1 ? "1 process" : p ? `${p} processes` : ""].filter(Boolean).join(", ");
}

function statusOf(job: Job, n: JobNode | null): { main: string; sub: string } {
  if (job.status === "running") {
    const s = job.steps?.find((x) => x.status === "running");
    const at = job.steps?.length && s ? `Step ${job.steps.indexOf(s) + 1} of ${job.steps.length} · ${s.label}` : "";
    return { main: "Running", sub: at || job.message || "" };
  }
  if (job.status === "failed" && !job.interrupted)
    return { main: "Failed", sub: failedStep(job)?.label ?? problemText(job).what };
  const line = resultLine(job);
  const [main, ...rest] = line.split(" · ");
  return { main, sub: rest.join(" · ") || (n ? childSummary(n) : "") };
}

function Bar({ job }: { job: Job }) {
  const steps = job.steps ?? [];
  if (job.status === "running" && steps.length > 1)
    return (
      <div className="jt-prog">
        <div
          className="jt-segs"
          role="progressbar"
          aria-label={`${kindLabel(job.kind)} steps`}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={steps.filter((s) => s.status === "done").length}
        >
          {steps.map((s) => {
            const pct = s.status === "running" && s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null;
            return (
              <span
                key={s.id}
                className={cx("jt-seg", `t-${stepTone(s.status, job.interrupted)}`)}
                style={pct !== null ? ({ "--pct": `${pct}%` } as CSSProperties) : undefined}
              />
            );
          })}
        </div>
        <span className="muted jt-small">
          {steps.filter((s) => s.status === "done").length} of {steps.length} steps
        </span>
      </div>
    );
  if (job.status === "running") {
    const pct = percent(job);
    return (
      <div className="jt-prog">
        <div
          className="prog"
          role="progressbar"
          aria-label={`${kindLabel(job.kind)} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
        >
          <span
            style={{ width: pct === null ? "35%" : `${pct}%` }}
            className={pct === null ? "prog-busy" : "jt-fill"}
          />
        </div>
        {job.progress && (
          <span className="muted jt-small">
            {job.progress.done} of {job.progress.total}
          </span>
        )}
      </div>
    );
  }
  return (
    <span className="muted jt-small">
      {job.progress?.total ? `${job.progress.done} of ${job.progress.total}` : "—"}
    </span>
  );
}

function Row({
  depth,
  on,
  open,
  label,
  onToggle,
  onPick,
  main,
  status,
  prog,
  time,
}: {
  depth: number;
  on?: boolean;
  open?: boolean;
  label: string;
  onToggle?: () => void;
  onPick?: () => void;
  main: ReactNode;
  status: ReactNode;
  prog: ReactNode;
  time: ReactNode;
}) {
  return (
    <tr
      className={cx("jt-row", depth > 0 && "jt-child", on && "row-on", !onPick && "jt-leaf")}
      aria-selected={onPick ? !!on : undefined}
      tabIndex={onPick ? 0 : -1}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPick?.();
        else if (e.key === "ArrowRight" && onToggle && !open) onToggle();
        else if (e.key === "ArrowLeft" && onToggle && open) onToggle();
      }}
    >
      <td className="jt-job" style={{ "--depth": depth } as CSSProperties}>
        <div className="jt-cell">
          {depth > 0 && <span className="jt-elbow" aria-hidden="true" />}
          {onToggle ? (
            <button
              type="button"
              className="jt-tog"
              aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
              aria-expanded={!!open}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <Icon name={open ? "down" : "right"} size={14} />
            </button>
          ) : (
            <span className="jt-tog-gap" />
          )}
          {main}
        </div>
      </td>
      <td>{status}</td>
      <td>{prog}</td>
      <td className="jt-time">{time}</td>
    </tr>
  );
}

function ProcessRow({ p, depth, now }: { p: JobProcess; depth: number; now: number }) {
  const running = !p.endedAt;
  const ok = p.exit === 0;
  const claude = p.label.startsWith("Claude");
  return (
    <Row
      depth={depth}
      label={p.label}
      main={
        <>
          <KindTile kind={claude ? "claude" : "process"} small />
          <div className="jt-text">
            <div className="jt-title jt-title-sm">{processLabel(p.label)}</div>
            <div className="muted jt-sub">
              Process · {p.command}
              {p.pid ? ` · pid ${p.pid}` : ""}
            </div>
          </div>
        </>
      }
      status={
        <span className={cx("jt-state", `t-${running ? "run" : ok ? "ok" : "err"}`)}>
          <StateIcon tone={running ? "run" : ok ? "ok" : "err"} />
          {running ? "Running" : ok ? "Ended" : `Ended with code ${p.exit ?? "?"}`}
        </span>
      }
      prog={<span className="muted jt-small">—</span>}
      time={<span className="mono">{duration({ startedAt: p.startedAt, endedAt: p.endedAt }, now)}</span>}
    />
  );
}

export function JobRows({ node, depth, c }: { node: JobNode; depth: number; c: RowCtx }) {
  const job = node.job;
  const kids = node.children.length + node.after.length + node.repeats.length + (job.processes?.length ?? 0);
  const open = kids > 0 && c.isOpen(node);
  const st = statusOf(job, node);
  const subject = subjectLabel(job, c.byId);
  const tone = toneOf(job);
  const more = inside(node);
  const cause = job.cause && depth > 0 ? CAUSE[job.cause.why] : "";
  const title = node.repeats.length ? `${kindLabel(job.kind)} ×${node.repeats.length + 1}` : kindLabel(job.kind);
  const parts = [subject, node.repeats.length ? `${node.repeats.length + 1} runs, the last shown` : more].filter(
    Boolean,
  );
  const processes = [...(job.processes ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return (
    <>
      <Row
        depth={depth}
        on={job.id === c.activeId}
        open={open}
        label={title}
        onToggle={kids ? () => c.toggle(job.id, !open) : undefined}
        onPick={() => c.pick(job.id)}
        main={
          <>
            <KindTile kind={job.kind} small={depth > 0} />
            <div className="jt-text">
              <div className={cx("jt-title", depth > 0 && "jt-title-sm")}>
                {kindLabel(job.kind)}
                {node.repeats.length > 0 && <span className="jt-times">×{node.repeats.length + 1}</span>}
              </div>
              <div className="muted jt-sub">
                {cause && <span className="jt-cause">{cause}</span>}
                {cause && parts.length ? " · " : ""}
                {parts.join(" · ")}
              </div>
            </div>
          </>
        }
        status={
          <div className={cx("jt-status", `t-${tone}`)}>
            <StateIcon tone={tone} />
            <div>
              <div className="jt-main">{st.main}</div>
              {st.sub && <div className="muted jt-sub">{st.sub}</div>}
            </div>
          </div>
        }
        prog={<Bar job={job} />}
        time={
          <>
            <div className="mono">{duration(job, c.now)}</div>
            <div className="muted jt-small">{clock(job.startedAt).slice(0, 5)}</div>
          </>
        }
      />
      {open && (
        <>
          {node.children.map((n) => (
            <JobRows key={n.job.id} node={n} depth={depth + 1} c={c} />
          ))}
          {processes.map((p) => (
            <ProcessRow key={p.id} p={p} depth={depth + 1} now={c.now} />
          ))}
          {node.after.map((n) => (
            <JobRows key={n.job.id} node={n} depth={depth + 1} c={c} />
          ))}
          {node.repeats.map((j) => (
            <JobRows key={j.id} node={{ job: j, children: [], after: [], repeats: [] }} depth={depth + 1} c={c} />
          ))}
        </>
      )}
    </>
  );
}
