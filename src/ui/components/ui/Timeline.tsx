import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none", minWidth: 0 },
  item: {
    boxSizing: "border-box",
    position: "relative",
    display: "grid",
    gridTemplateColumns: `${size.iconLg} minmax(0, 1fr)`,
    columnGap: space.s4,
    paddingBottom: space.s5,
  },
  last: { paddingBottom: 0 },
  compactItem: { columnGap: space.s3, paddingBottom: space.s3 },
  rail: {
    position: "absolute",
    insetInlineStart: `calc(${size.iconLg} / 2)`,
    top: `calc(${size.iconLg} + ${space.s2})`,
    bottom: space.s2,
    width: border.width,
    backgroundColor: color.borderStrong,
  },
  mark: { display: "flex", alignItems: "center", justifyContent: "center", width: size.iconLg, height: size.iconLg },
  done: { color: color.success },
  running: { color: color.accentText },
  runningClaude: { color: color.claudeText },
  failed: { color: color.danger },
  waiting: { color: color.textSubtle },
  head: { display: "flex", alignItems: "baseline", gap: space.s3, minWidth: 0, minHeight: size.iconLg },
  title: {
    minWidth: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
  },
  compactTitle: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
  titleWaiting: { color: color.textMuted, fontWeight: fontWeight.medium },
  titleRunning: { color: color.accentText },
  titleRunningClaude: { color: color.claudeText },
  titleFailed: { color: color.danger },
  small: {
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  note: { marginInlineStart: "auto" },
  body: {
    gridColumn: 2,
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    marginTop: space.s3,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
});

export type TimelineState = "done" | "running" | "failed" | "skipped" | "waiting";

export type TimelineItem = {
  /** stable across updates (the step's name or id) */
  key: string;
  state: TimelineState;
  title: ReactNode;
  /** when or how long (« 0:42 », « 09:15 ») */
  time?: string;
  /** on the right of the title (« 3 processes », « exit 1 ») */
  note?: ReactNode;
  /** under the title: what the step did, a banner, a nested Timeline (the processes of a step) */
  children?: ReactNode;
};

export type TimelineProps = {
  /** what the steps are of (« Steps of the job ») */
  label: string;
  items: TimelineItem[];
  /** claude: the running step is Claude's (What Claude did) — violet; else the accent */
  tone?: "accent" | "claude";
  /** nested under a step, or in a narrow pane: smaller titles, tighter */
  compact?: boolean;
};

const MARK: Record<TimelineState, { icon: IconName; word: string }> = {
  done: { icon: "check-circle", word: "Done" },
  running: { icon: "spinner", word: "Running" },
  failed: { icon: "x-circle", word: "Failed" },
  skipped: { icon: "minus", word: "Skipped" },
  waiting: { icon: "circle-dashed", word: "Waiting" },
};

// ponytail: the steps of a job or the phases of a Claude run, in order — each state is an icon whose word is read out,
// the colour only repeats it
export function Timeline({ label, items, tone = "accent", compact = false }: TimelineProps) {
  const claude = tone === "claude";
  return (
    <ol aria-label={label} {...stylex.props(styles.list)}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const look = {
          done: styles.done,
          running: claude ? styles.runningClaude : styles.running,
          failed: styles.failed,
          skipped: styles.waiting,
          waiting: styles.waiting,
        }[it.state];
        const titleLook = {
          done: null,
          running: claude ? styles.titleRunningClaude : styles.titleRunning,
          failed: styles.titleFailed,
          skipped: styles.titleWaiting,
          waiting: styles.titleWaiting,
        }[it.state];
        return (
          <li
            key={it.key}
            aria-current={it.state === "running" ? "step" : undefined}
            {...stylex.props(styles.item, compact && styles.compactItem, last && styles.last)}
          >
            {!last && <span aria-hidden="true" {...stylex.props(styles.rail)} />}
            <span {...stylex.props(styles.mark, look)}>
              {it.state === "running" ? (
                <Spinner size="sm" label={MARK.running.word} />
              ) : (
                <Icon name={MARK[it.state].icon} label={MARK[it.state].word} />
              )}
            </span>
            <div {...stylex.props(styles.head)}>
              <span {...stylex.props(styles.title, compact && styles.compactTitle, titleLook)}>{it.title}</span>
              {it.time && <span {...stylex.props(styles.small)}>{it.time}</span>}
              {it.note && <span {...stylex.props(styles.small, styles.note)}>{it.note}</span>}
            </div>
            {it.children && <div {...stylex.props(styles.body)}>{it.children}</div>}
          </li>
        );
      })}
    </ol>
  );
}
