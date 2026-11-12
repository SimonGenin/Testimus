import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { Phase } from "../../lib/activity.ts";
import { clock } from "../../lib/jobs.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useRowWindow, windowed } from "../ui/rowWindow.ts";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  steps: { margin: 0, paddingInlineStart: space.s5, display: "flex", flexDirection: "column", gap: space.s1 },
  at: { color: color.textSubtle, marginInlineEnd: space.s2 },
  warn: { color: color.warning },
  error: { color: color.danger },
});

// ponytail: a phase's actions one per line, in order — a generation's read phase has thousands; from 150 only those
// near what is seen are drawn (the kit's row window)
export function ActList({ acts }: { acts: Phase["acts"] }) {
  const frame = useRef<HTMLOListElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const keys = acts.map((_, i) => String(i));
  const win = useRowWindow(frame, rows, keys, []);
  return (
    <ol ref={frame} {...stylex.props(type.small, styles.steps)}>
      {windowed(
        win,
        acts,
        (_, i) => String(i),
        (a, i) => (
          <li
            key={i}
            ref={(el) => {
              if (el) rows.current.set(String(i), el);
              else rows.current.delete(String(i));
            }}
            data-level={a.level}
            {...stylex.props(a.level === "warn" && styles.warn, a.level === "error" && styles.error)}
          >
            <span {...stylex.props(type.mono, styles.at)}>{clock(a.at)}</span>
            {a.text}
          </li>
        ),
        (key, height) => (
          <li key={`room:${key}`} aria-hidden="true" style={{ height }} />
        ),
      )}
    </ol>
  );
}
