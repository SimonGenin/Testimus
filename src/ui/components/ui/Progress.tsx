import * as stylex from "@stylexjs/stylex";
import { color, easing, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";

const slide = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(340%)" },
});

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  track: {
    height: space.s2,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    overflow: "hidden",
  },
  bar: { height: "100%", borderRadius: radius.full, backgroundColor: color.accent },
  claude: { backgroundColor: color.claude },
  success: { backgroundColor: color.success },
  indeterminate: {
    width: "30%",
    animationName: slide,
    animationDuration: "1.2s",
    animationTimingFunction: easing.standard,
    animationIterationCount: "infinite",
  },
  detail: {
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
  },
});

export type ProgressProps = {
  /** 0 to 100; null or absent when the end is unknown (the bar slides) */
  value?: number | null;
  /** accent (default) · claude: a Claude run · success: done */
  tone?: "accent" | "claude" | "success";
  /** what is in progress (« Index ») — the bar's accessible name */
  label: string;
  /** what and how much, under the bar (« 12 / 40 sections · 1 min left ») */
  detail?: string;
};

// ponytail: a 4 px bar for a job with a known amount of work; the words beside it say what and how much
export function Progress({ value, tone = "accent", label, detail }: ProgressProps) {
  const known = typeof value === "number";
  const pct = known ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div {...stylex.props(styles.wrap)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuetext={detail}
        {...stylex.props(styles.track)}
      >
        <div
          {...stylex.props(styles.bar, tone !== "accent" && styles[tone], !known && styles.indeterminate)}
          style={known ? { width: `${pct}%` } : undefined}
        />
      </div>
      {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
    </div>
  );
}
