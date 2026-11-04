import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import type { JobEvent } from "../../../core/types.ts";
import { clock, logLines } from "../../lib/jobs.ts";
import { border, color, fontFamily, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";

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
