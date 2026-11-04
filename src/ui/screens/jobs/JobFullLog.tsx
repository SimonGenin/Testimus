import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { Switch } from "../../components/ui/Switch.tsx";
import { clock, type LogLine, logByStep } from "../../lib/jobs.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s2 },
  head: { display: "flex", alignItems: "center", gap: space.s3 },
  title: {
    flex: 1,
    margin: 0,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.semibold,
    color: color.textMuted,
  },
  box: {
    maxHeight: `calc(${lineHeight.code} * 24)`,
    overflowY: "auto",
    padding: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  lines: { display: "flex", flexDirection: "column", fontFamily: fontFamily.mono, fontSize: fontSize.code },
  line: { lineHeight: lineHeight.code, color: color.text, overflowWrap: "anywhere" },
  warn: { color: color.warning },
  error: { color: color.danger },
  at: { color: color.textSubtle, marginInlineEnd: space.s3 },
  part: { display: "flex", flexDirection: "column", gap: space.s1, marginBottom: space.s2 },
  partHead: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  empty: { color: color.textMuted, fontSize: fontSize.small },
});

export function LogLines({ lines }: { lines: LogLine[] }) {
  return (
    <div {...stylex.props(styles.lines)}>
      {lines.map((l, k) => (
        <div
          key={k}
          data-level={l.level}
          {...stylex.props(styles.line, l.level === "warn" && styles.warn, l.level === "error" && styles.error)}
        >
          <span {...stylex.props(styles.at)}>{clock(l.at)}</span>
          {l.text}
        </div>
      ))}
    </div>
  );
}

// ponytail: the whole log of a job, cut by step; it follows the end until it is scrolled up
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
    <section aria-label="Log" {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.head)}>
        <h3 {...stylex.props(styles.title)}>Log</h3>
        <Switch label="Warnings and errors only" on={only} onChange={setOnly} />
      </div>
      <div
        ref={box}
        role="log"
        aria-label="Live log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        {...stylex.props(styles.box)}
      >
        {!count && <span {...stylex.props(styles.empty)}>{only ? "No warning or error." : "Nothing logged yet."}</span>}
        {parts.map((p, i) => (
          <div key={i} {...stylex.props(styles.part)}>
            {p.step && (
              <div {...stylex.props(styles.partHead, p.step.status === "failed" && styles.error)}>
                {(job.steps?.indexOf(p.step) ?? -1) + 1} · {p.step.label}
              </div>
            )}
            <LogLines lines={p.lines} />
          </div>
        ))}
      </div>
    </section>
  );
}
