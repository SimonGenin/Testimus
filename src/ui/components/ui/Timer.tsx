import * as stylex from "@stylexjs/stylex";
import { color } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  timer: { whiteSpace: "nowrap", color: color.claudeText },
  quiet: { color: color.textMuted },
});

export type TimerProps = {
  /** the seconds since the work started, as m:ss (h:mm:ss past an hour) */
  seconds: number;
  /** what it counts, read out */
  label?: string;
  /** claude (default): a Claude run's seconds · quiet: any other job's, in the muted text colour */
  tone?: "claude" | "quiet";
};

export const elapsed = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// ponytail: the seconds counter of running work (kit.css .timer) — mono, tabular, violet for Claude; the one place it
// is drawn (the Claude block's footer, Generate's running card)
export function Timer({ seconds, label = "Time since it started", tone = "claude" }: TimerProps) {
  return (
    <span
      role="timer"
      aria-label={label}
      {...stylex.props(type.code, type.tabular, styles.timer, tone === "quiet" && styles.quiet)}
    >
      {elapsed(seconds)}
    </span>
  );
}
