import { useEffect, useRef, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { plural } from "../../lib/format.ts";
import { type LocalWork, onLocalWork } from "../../lib/localActivity.ts";
import { errorToast } from "../../lib/toast.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";

type Live = { job: Job; message?: string; done?: number; total?: number };
type Row = {
  key: string;
  id?: string;
  kind: string;
  label: string;
  message?: string;
  startedAt: string;
  done?: number;
  total?: number;
};
type Tone = "doc" | "claude" | "plain";

const KIND: Record<string, [IconName, Tone]> = {
  "docs.add": ["documents", "doc"],
  "docs.convert": ["documents", "doc"],
  "rag-index": ["documents", "doc"],
  "describe-figures": ["image", "claude"],
  generate: ["generate", "claude"],
  fix: ["claude", "claude"],
  check: ["claude", "claude"],
  columns: ["claude", "claude"],
  claude: ["claude", "claude"],
  chat: ["claude", "claude"],
  "actions.triage": ["claude", "claude"],
  "gen-bench": ["claude", "claude"],
  "rag-eval": ["search", "plain"],
  "models-measure": ["search", "plain"],
  pull: ["pull", "plain"],
  push: ["push", "plain"],
  jira: ["folder", "plain"],
};

const kindOf = (kind: string): [IconName, Tone] =>
  KIND[kind] ?? (kind.startsWith("models") ? ["pull", "plain"] : ["jobs", "plain"]);

export function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Activity() {
  const [jobs, setJobs] = useState<Record<string, Live>>({});
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number }>();
  const [notice, setNotice] = useState("");
  const [local, setLocal] = useState<LocalWork[]>([]);
  useEffect(() => onLocalWork(setLocal), []);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  // ponytail: a list answer can land after the event that ended one of its jobs — that job stays ended
  const ended = useRef(new Set<string>());

  const seed = () =>
    call<Job[]>("jobs.list", { running: true })
      .then((list) =>
        setJobs((cur) => {
          const next: Record<string, Live> = {};
          for (const j of Array.isArray(list) ? list : [])
            if (j.status === "running" && !ended.current.has(j.id))
              next[j.id] = { ...cur[j.id], job: j, message: cur[j.id]?.message ?? j.message };
          return next;
        }),
      )
      .catch(() => {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: once — the event stream keeps it current
  useEffect(() => {
    void seed();
    return events((e) => {
      if (e.type === "status")
        setJobs((cur) => {
          const next = { ...cur };
          if (e.job.status === "running")
            next[e.jobId] = { ...cur[e.jobId], job: e.job, message: cur[e.jobId]?.message ?? e.job.message };
          else {
            ended.current.add(e.jobId);
            delete next[e.jobId];
          }
          return next;
        });
      else if (e.type === "notice") setNotice(e.message);
      else if (e.type === "progress")
        setJobs((cur) =>
          cur[e.jobId]
            ? {
                ...cur,
                [e.jobId]: {
                  ...cur[e.jobId],
                  message: e.message,
                  ...(e.total !== undefined && { done: e.done ?? 0, total: e.total }),
                },
              }
            : cur,
        );
    });
  }, []);

  const rows: Row[] = [
    ...local.map((w) => ({ key: `l${w.id}`, kind: w.kind, label: w.label, startedAt: w.startedAt })),
    ...Object.values(jobs)
      .sort((a, b) => a.job.startedAt.localeCompare(b.job.startedAt))
      .map(({ job, message, done, total }) => ({
        key: job.id,
        id: job.id,
        kind: job.kind,
        label: job.subject || job.kind,
        message,
        startedAt: job.startedAt,
        done: done ?? job.progress?.done,
        total: total ?? job.progress?.total,
      })),
  ];
  const count = rows.length;

  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(tick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className="activity" ref={box}>
      {notice && (
        <span className="activity-notice" role="status">
          {notice}
        </span>
      )}
      {count > 0 && (
        <button
          type="button"
          className="activity-btn"
          aria-expanded={open}
          aria-label={`${plural(count, "job")} running`}
          title={`${plural(count, "job")} running — click for details`}
          onClick={(e) => {
            if (!open) {
              void seed();
              // ponytail: fixed, from the button — a narrow panel's overflow would cut a popover anchored inside it
              const r = e.currentTarget.getBoundingClientRect();
              const w = Math.min(380, window.innerWidth * 0.9);
              setAt({ top: r.bottom + 8, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
            }
            setOpen((o) => !o);
          }}
        >
          <svg className="busy-ring" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 1.8a6.2 6.2 0 0 1 6.2 6.2" />
          </svg>
          <span className="activity-count">{count}</span>
        </button>
      )}
      {open && count > 0 && (
        <div className="activity-pop" role="dialog" aria-label="Running jobs" style={at}>
          <div className="busy-head">
            <span className="busy-title">Running</span>
            <span className="busy-count mono">{count}</span>
          </div>
          {rows.map((r) => {
            const [icon, tone] = kindOf(r.kind);
            const sized = r.total !== undefined && r.total > 0;
            return (
              <div key={r.key} className={`busy busy-${tone}`}>
                <span className="busy-tile" title={r.kind}>
                  <Icon name={icon} />
                </span>
                <span className="busy-body">
                  <span className="busy-label">{r.label}</span>
                  {r.message && <span className="busy-detail">{r.message}</span>}
                  <span className="busy-meta">
                    <span className={sized ? "busy-bar" : "busy-bar is-open"}>
                      <span
                        className="busy-fill"
                        style={
                          sized ? { width: `${Math.min(100, ((r.done ?? 0) / (r.total ?? 1)) * 100)}%` } : undefined
                        }
                      />
                    </span>
                    {sized && (
                      <span className="busy-steps mono">
                        {r.done ?? 0}/{r.total}
                      </span>
                    )}
                    <span className="busy-time mono">{elapsed(r.startedAt, now)}</span>
                  </span>
                </span>
                {r.id && (
                  <IconButton
                    icon="close"
                    label={`Cancel ${r.label}`}
                    title="Cancel"
                    onClick={() => call("jobs.cancel", { id: r.id }).catch((e) => errorToast(e, "Could not cancel"))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
