import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { color, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";

const RETRY_AFTER_MS = 10_000;

const shimmer = stylex.keyframes({
  "0%": { backgroundPosition: "100% 0" },
  "100%": { backgroundPosition: "-100% 0" },
});

const styles = stylex.create({
  bar: {
    display: "block",
    flexShrink: 0,
    height: size.skeletonLine,
    borderRadius: radius.r1,
    backgroundImage: `linear-gradient(90deg, ${color.surfaceSunken} 0%, ${color.surfaceHover} 50%, ${color.surfaceSunken} 100%)`,
    backgroundSize: "200% 100%",
    animationName: shimmer,
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  text: { marginBlock: `calc((${lineHeight.body} - ${size.skeletonLine}) / 2)` },
  title: { height: size.iconSm },
  block: { height: space.s10, borderRadius: radius.r3 },
  circle: { width: size.iconMd, height: size.iconMd, borderRadius: radius.full },
  w70: { width: "70%" },
  w60: { width: "60%" },
  w40: { width: "40%" },
  lines: { display: "flex", flexDirection: "column", minWidth: 0 },
  grow: { flex: 1 },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s5,
  },
  late: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    color: color.textMuted,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
});

export type SkeletonProps = {
  /** text: a 10 px line (default) · title: a 14 px line · block: a 64 px card or figure · circle: an icon · row: a list
   * row (an icon and two lines) */
  kind?: "text" | "title" | "block" | "circle" | "row";
  /** a percentage or a size token (« 70% », size.sidebar); default the full width */
  width?: string;
  /** several text lines, the last one shorter */
  lines?: number;
  /** after 10 s without data the skeleton becomes « Still loading » with Retry, which calls this */
  onRetry?: () => void;
  /** the catalogue only: the « Still loading » state at once */
  debugState?: "late";
};

// ponytail: the shape of what is loading, at the size of the content it stands for, so nothing moves when it lands;
// never stale rows, never a centred spinner
export function Skeleton({ kind = "text", width, lines = 1, onRetry, debugState }: SkeletonProps) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!onRetry) return;
    const t = setTimeout(() => setLate(true), RETRY_AFTER_MS);
    return () => clearTimeout(t);
  }, [onRetry]);
  if ((late || debugState === "late") && onRetry)
    return (
      <div role="status" {...stylex.props(styles.late)}>
        Still loading — this is taking longer than usual.
        <Button
          size="sm"
          label="Retry"
          icon="refresh"
          onClick={() => {
            setLate(false);
            onRetry();
          }}
        />
      </div>
    );
  if (kind === "row")
    return (
      <div aria-hidden="true" {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.bar, styles.circle)} />
        <span {...stylex.props(styles.lines, styles.grow)}>
          <span {...stylex.props(styles.bar, styles.text, styles.w70)} />
          <span {...stylex.props(styles.bar, styles.text, styles.w40)} />
        </span>
      </div>
    );
  if (kind === "text" && lines > 1)
    return (
      <span aria-hidden="true" {...stylex.props(styles.lines)}>
        {Array.from({ length: lines }, (_, i) => `line-${i + 1}`).map((id, i) =>
          i === lines - 1 ? (
            <span key={id} {...stylex.props(styles.bar, styles.text, styles.w60)} />
          ) : (
            <span key={id} {...stylex.props(styles.bar, styles.text)} style={width ? { width } : undefined} />
          ),
        )}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      {...stylex.props(styles.bar, kind !== "text" && styles[kind], kind === "text" && styles.text)}
      style={width ? { width } : undefined}
    />
  );
}
