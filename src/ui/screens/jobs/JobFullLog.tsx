import { useEffect, useRef, useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { cx } from "../../lib/format.ts";
import { clock, logByStep } from "../../lib/jobs.ts";

export function FullLog({ job, events }: { job: Job; events: JobEvent[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [only, setOnly] = useState(false);
  const parts = logByStep(events, job.steps)
    .map((p) => ({ ...p, lines: only ? p.lines.filter((l) => l.level !== "info") : p.lines }))
    .filter((p) => p.lines.length);
  const count = parts.reduce((n, p) => n + p.lines.length, 0);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current && count) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <div className="jd-log">
      <div className="jd-loghead">
        <h3 className="jd-h3">Log</h3>
        <span className="spacer" />
        <label className="jd-only">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          Warnings and errors only
        </label>
      </div>
      <div
        ref={box}
        className="log jd-loglines"
        role="log"
        aria-label="Live log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {!count && <span className="muted">{only ? "No warning or error." : "Nothing logged yet."}</span>}
        {parts.map((p, i) => (
          <div key={i} className="jd-part">
            {p.step && (
              <div className={cx("jd-parthead", p.step.status === "failed" && "log-error")}>
                {(job.steps?.indexOf(p.step) ?? -1) + 1} · {p.step.label}
              </div>
            )}
            {p.lines.map((l, k) => (
              <div key={k} className={cx(l.level === "warn" && "log-warn", l.level === "error" && "log-error")}>
                <span className="log-at">{clock(l.at)}</span>
                {l.text}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
