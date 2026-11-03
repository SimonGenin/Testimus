import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { clock, logLines } from "../../lib/jobs.ts";
import { border, color, fontFamily, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";

export function useJob(jobId: string | null): { job: Job | null; events: JobEvent[]; error: string } {
  const [job, setJob] = useState<Job | null>(null);
  const [list, setList] = useState<JobEvent[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setJob(null);
    setList([]);
    setError("");
    if (!jobId) return;
    let dead = false;
    const early: JobEvent[] = [];
    let loaded = false;
    let finished = false;
    const off = events((e) => {
      if (e.jobId !== jobId) return;
      if (e.type === "status") {
        setJob(e.job);
        finished = e.job.status !== "running";
      }
      if (!loaded) early.push(e);
      else setList((l) => [...l, e]);
    });
    // ponytail: the event stream can drop events between two reconnects (or be missing), so a running job is
    // also read back now and then; the server's log is complete, the stream only makes it live
    const read = () =>
      call<{ job: Job; events: JobEvent[] }>("jobs.show", { id: jobId })
        .then((r) => {
          if (dead) return;
          const known = r?.events ?? [];
          const last = known[known.length - 1]?.at ?? "";
          setList((cur) =>
            loaded ? (cur.length > known.length ? cur : known) : [...known, ...early.filter((e) => e.at > last)],
          );
          loaded = true;
          if (r?.job) {
            finished = r.job.status !== "running";
            setJob((j) => (j && j.status !== "running" ? j : r.job));
          }
        })
        .catch((e) => !dead && !loaded && setError(e instanceof Error ? e.message : String(e)));
    void read();
    const poll = setInterval(() => {
      if (!finished) void read();
    }, 1500);
    return () => {
      dead = true;
      clearInterval(poll);
      off();
    };
  }, [jobId]);
  return { job, events: list, error };
}

const styles = stylex.create({
  log: {
    maxHeight: "50vh",
    overflow: "auto",
    padding: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  empty: { color: color.textMuted },
  warn: { color: color.warning },
  error: { color: color.danger },
  at: { color: color.textSubtle, marginInlineEnd: space.s3 },
});

// ponytail: a job's log as it comes, kept scrolled to the end unless the reader scrolled up
export function JobLog({ events: list, label = "Live log" }: { events: JobEvent[]; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const lines = logLines(list);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current && lines.length) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div
      ref={box}
      role="log"
      aria-label={label}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      {...stylex.props(styles.log)}
    >
      {!lines.length && <span {...stylex.props(styles.empty)}>Nothing logged yet.</span>}
      {lines.map((l, i) => (
        <div
          key={i}
          data-level={l.level}
          {...stylex.props(l.level === "warn" && styles.warn, l.level === "error" && styles.error)}
        >
          <span {...stylex.props(styles.at)}>{clock(l.at)}</span>
          {l.text}
        </div>
      ))}
    </div>
  );
}
