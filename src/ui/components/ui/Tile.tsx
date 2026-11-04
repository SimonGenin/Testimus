import * as stylex from "@stylexjs/stylex";
import { color, radius, size } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  tile: {
    boxSizing: "border-box",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlMd,
    height: size.controlMd,
    borderRadius: radius.r2,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  sm: { width: size.controlXs, height: size.controlXs, borderRadius: radius.r1 },
  lg: { width: size.controlLg, height: size.controlLg },
  neutral: { backgroundColor: color.surfaceSunken, color: color.textMuted },
  accent: { backgroundColor: color.accentSubtle, color: color.accentText },
  claude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
});

export type TileProps = {
  /** what the thing is (a job's kind): its icon on the tile */
  icon?: IconName;
  /** or who or which it is (a project): up to two letters */
  initials?: string;
  /** neutral (default: a job, a kind) · accent (a project) · claude (a Claude run) */
  tone?: "neutral" | "accent" | "claude";
  /** sm 24 px (a dense row) · md 32 px (default, a list row, the rail) · lg 40 px (a detail's head) */
  size?: "sm" | "md" | "lg";
  /** read out when the tile says something its row does not (else it is decoration) */
  label?: string;
};

// ponytail: a square that stands for a thing at the start of its row (shell.mjs .rail__avatar) — a project's initials,
// a job's kind; the one tile of the app
export function Tile({ icon, initials, tone = "neutral", size: s = "md", label }: TileProps) {
  const look = stylex.props(
    s === "sm" ? type.caption : type.small,
    type.strong,
    styles.tile,
    s === "sm" && styles.sm,
    s === "lg" && styles.lg,
    styles[tone],
  );
  const mark = icon ? <Icon name={icon} size={s === "sm" ? "sm" : "md"} /> : initials?.slice(0, 2);
  return label ? (
    <span role="img" aria-label={label} {...look}>
      {mark}
    </span>
  ) : (
    <span aria-hidden="true" {...look}>
      {mark}
    </span>
  );
}
