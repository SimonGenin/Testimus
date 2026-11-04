import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { color, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  raw: {
    boxSizing: "border-box",
    display: "block",
    margin: 0,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    overflow: "auto",
  },
  tall: (lines: number) => ({ maxHeight: `calc(${lineHeight.code} * ${lines} + ${space.s3} * 2)` }),
  line: { display: "block", minHeight: lineHeight.code },
  warn: { color: color.warning },
  error: { color: color.danger },
  at: { color: color.textSubtle, marginInlineEnd: space.s3 },
  empty: { color: color.textSubtle },
});

export type RawLine = {
  text: string;
  /** warn and error lines take the warning and danger colours */
  level?: "info" | "warn" | "error";
  /** when it was written, as shown (« 10:42:03 »), before the text */
  at?: string;
};

export type RawProps = {
  /** the output as it came (stdout, a stack, a diagnosis), kept as it is */
  text?: string;
  /** a log: one line each, with its level and its time */
  lines?: RawLine[];
  /** shown when there is no text and no line */
  empty?: string;
  /** the tallest it grows, in lines, before it scrolls; default: as tall as its text */
  maxLines?: number;
  /** a live log: kept scrolled to the end as lines come, unless the reader scrolled up (role log) */
  follow?: boolean;
  /** the accessible name (« Raw output », « Live log ») */
  label?: string;
};

// ponytail: raw output (kit.css .raw) — mono on a sunken well, text muted, pre-wrap: Claude's raw output, a job's log, a
// failure's raw text, a command line; the one place this block is drawn
export function Raw({ text, lines, empty = "(no output)", maxLines, follow = false, label }: RawProps) {
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const count = lines?.length ?? text?.length ?? 0;
  useEffect(() => {
    const el = box.current;
    if (follow && el && stick.current && count) el.scrollTop = el.scrollHeight;
  }, [follow, count]);
  const blank = !text && !lines?.length;
  const named = label ? { role: follow ? "log" : "group", "aria-label": label } : follow ? { role: "log" } : {};
  return (
    <pre
      ref={box}
      {...named}
      tabIndex={maxLines ? 0 : undefined}
      onScroll={
        follow
          ? (e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight / 10;
            }
          : undefined
      }
      {...stylex.props(type.code, styles.raw, maxLines !== undefined && styles.tall(maxLines))}
    >
      {blank && <span {...stylex.props(styles.empty)}>{empty}</span>}
      {!lines && text}
      {lines?.map((l, i) => (
        <span
          key={i}
          data-level={l.level ?? "info"}
          {...stylex.props(styles.line, l.level === "warn" && styles.warn, l.level === "error" && styles.error)}
        >
          {l.at && <span {...stylex.props(styles.at)}>{l.at}</span>}
          {l.text}
        </span>
      ))}
    </pre>
  );
}
