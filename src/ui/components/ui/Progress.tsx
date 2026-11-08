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
  thick: { display: "flex", height: space.s3, backgroundColor: color.neutralSubtle },
  bar: { height: "100%", borderRadius: radius.full, backgroundColor: color.accent },
  segment: { flex: "none", height: "100%", backgroundColor: color.accent },
  claude: { backgroundColor: color.claude },
  success: { backgroundColor: color.success },
  danger: { backgroundColor: color.danger },
  warning: { backgroundColor: color.warning },
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

export type ProgressSegment = {
  /** its share of the whole, 0 to 100 */
  value: number;
  tone: "accent" | "claude" | "success" | "danger" | "warning";
};

export type ProgressProps = {
  /** 0 to 100; null or absent when the end is unknown (the bar slides) */
  value?: number | null;
  /** accent (default) · claude: a Claude run · success: done */
  tone?: "accent" | "claude" | "success";
  /** what is in progress (« Index ») — the bar's accessible name */
  label: string;
  /** what and how much, under the bar (« 12 / 40 sections · 1 min left ») */
  detail?: string;
  /** the work split by outcome (passed, problem, blocked…), each share in its tone side by side on an 8 px track; the
   * track left bare is what is still to do — the value is their sum */
  segments?: ProgressSegment[];
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));

// ponytail: a 4 px bar for a job with a known amount of work; the words beside it say what and how much
export function Progress({ value, tone = "accent", label, detail, segments }: ProgressProps) {
  let left = 100;
  const parts = (segments ?? []).map((seg) => {
    const width = Math.min(left, clamp(seg.value));
    left -= width;
    return { tone: seg.tone, width };
  });
  const known = !!segments || typeof value === "number";
  const pct = segments ? 100 - left : clamp(value ?? 0);
  return (
    <div {...stylex.props(styles.wrap)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuetext={detail}
        {...stylex.props(styles.track, segments && styles.thick)}
      >
        {segments ? (
          parts.map((p, i) =>
            p.width > 0 ? (
              <div
                key={i}
                {...stylex.props(styles.segment, p.tone !== "accent" && styles[p.tone])}
                style={{ width: `${p.width}%` }}
              />
            ) : null,
          )
        ) : (
          <div
            {...stylex.props(styles.bar, tone !== "accent" && styles[tone], !known && styles.indeterminate)}
            style={known ? { width: `${pct}%` } : undefined}
          />
        )}
      </div>
      {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
    </div>
  );
}
