import * as stylex from "@stylexjs/stylex";
import { border, color, fontSize, fontWeight, radius, size } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  avatar: {
    boxSizing: "border-box",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlXs,
    height: size.controlXs,
    borderRadius: radius.full,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    lineHeight: 1,
    userSelect: "none",
  },
  sm: { width: size.iconLg, height: size.iconLg },
  nobody: {
    borderStyle: "dashed",
    borderWidth: border.width,
    borderColor: color.borderControl,
    color: color.textSubtle,
  },
  t0: { backgroundColor: color.accentSubtle, color: color.accentText },
  t1: { backgroundColor: color.claudeSubtle, color: color.claudeText },
  t2: { backgroundColor: color.successSubtle, color: color.success },
  t3: { backgroundColor: color.warningSubtle, color: color.warning },
  t4: { backgroundColor: color.infoSubtle, color: color.info },
  t5: { backgroundColor: color.neutralSubtle, color: color.textMuted },
});

const TINTS = [styles.t0, styles.t1, styles.t2, styles.t3, styles.t4, styles.t5];

// ponytail: a person's tint follows their account (the same person, the same colour on every screen and every PC)
const tintOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
};

export const initials = (name: string) => {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const two = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? "?"];
  return two
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export type AvatarProps = {
  /** the person's name; absent: nobody (a dashed circle) */
  name?: string | null;
  /** what fixes the tint (a Jira account id); the name when absent */
  id?: string | null;
  /** md 24 px (default) · sm 20 px (a list row, a button) */
  size?: "sm" | "md";
};

// ponytail: a person, as initials on a tint (SYSTEM.md Avatar) — decoration beside a name that is always written
// next to it, so it is hidden from screen readers
export function Avatar({ name, id, size: s = "md" }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="avatar"
      {...stylex.props(styles.avatar, s === "sm" && styles.sm, name ? tintOf(id || name) : styles.nobody)}
    >
      {name ? initials(name) : ""}
    </span>
  );
}
