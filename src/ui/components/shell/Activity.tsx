import { useEffect, useRef, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { plural } from "../../lib/format.ts";
import { type LocalWork, onLocalWork } from "../../lib/localActivity.ts";
import { errorToast } from "../../lib/toast.ts";
import { Button } from "../ui/index.ts";

type Live = { job: Job; message?: string };

const GLYPH: Record<string, string> = {
  pull: "↓",
  push: "↑",
  generate: "✦",
  fix: "✦",
  check: "✦",
  claude: "✦",
  chat: "✦",
};

export function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Activity() {
  const [jobs, setJobs] = useState<Record<string, Live>>({});
  const [open, setOpen] = useState(false);
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
              next[j.id] = { job: j, message: cur[j.id]?.message ?? j.message };
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
            next[e.jobId] = { job: e.job, message: cur[e.jobId]?.message ?? e.job.message };
          else {
            ended.current.add(e.jobId);
            delete next[e.jobId];
          }
          return next;
        });
      else if (e.type === "notice") setNotice(e.message);
      else if (e.type === "progress")
        setJobs((cur) => (cur[e.jobId] ? { ...cur, [e.jobId]: { ...cur[e.jobId], message: e.message } } : cur));
    });
  }, []);

  const list = Object.values(jobs).sort((a, b) => a.job.startedAt.localeCompare(b.job.startedAt));
  const count = list.length + local.length;

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
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      clearInterval(tick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
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
          onClick={() => {
            if (!open) void seed();
            setOpen((o) => !o);
          }}
        >
          <span className="spin spin-sm" aria-hidden="true" />
          <span className="activity-count">{count}</span>
        </button>
      )}
      {open && count > 0 && (
        <div className="activity-pop" role="dialog" aria-label="Running jobs">
          {local.map((w) => (
            <div key={`l${w.id}`} className="act">
              <span className="act-glyph" aria-hidden="true" title={w.kind}>
                ↓
              </span>
              <span className="act-body">
                <span className="act-label">{w.label}</span>
              </span>
              <span className="act-time mono">{elapsed(w.startedAt, now)}</span>
            </div>
          ))}
          {list.map(({ job, message }) => (
            <div key={job.id} className="act">
              <span className="act-glyph" aria-hidden="true" title={job.kind}>
                {GLYPH[job.kind] ?? "·"}
              </span>
              <span className="act-body">
                <span className="act-label">{job.subject || job.kind}</span>
                {message && <span className="act-detail">{message}</span>}
              </span>
              <span className="act-time mono">{elapsed(job.startedAt, now)}</span>
              <Button
                size="sm"
                tone="quiet"
                aria-label={`Cancel ${job.subject || job.kind}`}
                onClick={() => call("jobs.cancel", { id: job.id }).catch((e) => errorToast(e, "Could not cancel"))}
              >
                Cancel
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
