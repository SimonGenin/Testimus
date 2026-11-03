import * as stylex from "@stylexjs/stylex";
import { border, color, fontSize, fontWeight, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  badge: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    height: size.controlXs,
    paddingBlock: 0,
    paddingInlineStart: space.s2,
    paddingInlineEnd: space.s3,
    borderRadius: radius.r1,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  },
  noIcon: { paddingInline: space.s3 },
  neutral: { color: color.neutral, backgroundColor: color.neutralSubtle },
  info: { color: color.info, backgroundColor: color.infoSubtle },
  success: { color: color.success, backgroundColor: color.successSubtle },
  warning: { color: color.warning, backgroundColor: color.warningSubtle },
  danger: { color: color.danger, backgroundColor: color.dangerSubtle },
  claude: { color: color.claudeText, backgroundColor: color.claudeSubtle },
  accent: { color: color.accentText, backgroundColor: color.accentSubtle },
  outline: { backgroundColor: "transparent", boxShadow: `inset 0 0 0 ${border.width} currentColor` },
  sm: {
    height: size.iconMd,
    paddingInline: space.s2,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
  },
  count: {
    justifyContent: "center",
    minWidth: size.kbd,
    height: size.kbd,
    paddingInline: space.s2,
    borderRadius: radius.full,
    fontVariantNumeric: "tabular-nums",
  },
  countSm: { minWidth: size.iconMd, height: size.iconMd, fontSize: fontSize.caption, lineHeight: lineHeight.caption },
  dot: {
    width: space.s3,
    height: space.s3,
    paddingBlock: 0,
    paddingInlineStart: 0,
    paddingInlineEnd: 0,
    borderRadius: radius.full,
  },
  dotNeutral: { backgroundColor: color.neutral },
  dotInfo: { backgroundColor: color.info },
  dotSuccess: { backgroundColor: color.success },
  dotWarning: { backgroundColor: color.warning },
  dotDanger: { backgroundColor: color.danger },
  dotClaude: { backgroundColor: color.claude },
  dotAccent: { backgroundColor: color.accent },
});

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "claude" | "accent";

const DOT = {
  neutral: styles.dotNeutral,
  info: styles.dotInfo,
  success: styles.dotSuccess,
  warning: styles.dotWarning,
  danger: styles.dotDanger,
  claude: styles.dotClaude,
  accent: styles.dotAccent,
} as const;

export type BadgeProps = {
  /** one or two words (« To fix », « In sync »), or the number of a count */
  label: string;
  /** a meaning, never a look: neutral (Draft, Local) · info (Checked) · success (Validated, In sync) · warning (To
   * fix, Modified) · danger (Conflict, Error) · claude (Changed by Claude, Generated) · accent (a selected tab's count) */
  tone?: BadgeTone;
  /** beside the word: the icon and the word carry the meaning, the tone repeats it */
  icon?: IconName;
  /** a state that is a link or a reference (« Jira version ») */
  outline?: boolean;
  /** md 20 px (default) · sm 16 px, in dense meta lines and tab counts */
  size?: "sm" | "md";
  /** a number pill */
  count?: boolean;
  /** a state on an icon (the rail's system status): a dot whose label is read out */
  dot?: boolean;
  /** work in progress (Running, Indexing…): a spinner replaces the icon */
  busy?: boolean;
  /** more words on hover and focus */
  tooltip?: string;
};

// ponytail: a short state attached to a thing — the review state, a finding's severity, a sync state, a diff mark, a
// count; the fixed vocabularies below are the only words screens use for them
export function Badge({
  label,
  tone = "neutral",
  icon,
  outline = false,
  size: s = "md",
  count = false,
  dot = false,
  busy = false,
  tooltip,
}: BadgeProps) {
  const badge = dot ? (
    <span role="img" aria-label={label} {...stylex.props(styles.badge, styles.dot, DOT[tone])} />
  ) : (
    <span
      aria-busy={busy || undefined}
      {...stylex.props(
        styles.badge,
        styles[tone],
        !icon && !busy && styles.noIcon,
        outline && styles.outline,
        s === "sm" && styles.sm,
        count && styles.count,
        count && s === "sm" && styles.countSm,
      )}
    >
      {busy ? <Spinner size="sm" /> : icon && <Icon name={icon} size="sm" />}
      {label}
    </span>
  );
  return tooltip ? <Tooltip label={tooltip}>{badge}</Tooltip> : badge;
}

type Word = { label: string; tone: BadgeTone; icon: IconName };

export type ReviewState = "draft" | "checked" | "to-fix" | "validated";
export type Severity = "error" | "warning" | "info";

export const REVIEW: Record<ReviewState, Word> = {
  draft: { label: "Draft", tone: "neutral", icon: "circle-dashed" },
  checked: { label: "Checked", tone: "info", icon: "check-circle" },
  "to-fix": { label: "To fix", tone: "warning", icon: "to-fix" },
  validated: { label: "Validated", tone: "success", icon: "validated" },
};

export const SEVERITY: Record<Severity, Word> = {
  error: { label: "Error", tone: "danger", icon: "x-circle" },
  warning: { label: "Warning", tone: "warning", icon: "alert-triangle" },
  info: { label: "Info", tone: "info", icon: "info" },
};

export const SYNC = {
  checking: { label: "Checking…", tone: "info", icon: "sync" },
  "in-sync": { label: "In sync", tone: "success", icon: "check" },
  modified: { label: "Modified", tone: "warning", icon: "sync" },
  "changed-in-jira": { label: "Changed in Jira", tone: "warning", icon: "cloud" },
  conflict: { label: "Conflict", tone: "danger", icon: "conflict" },
  local: { label: "Local only", tone: "neutral", icon: "file" },
} as const satisfies Record<string, Word>;

export const DIFF = {
  new: { label: "New", tone: "success", icon: "plus" },
  modified: { label: "Modified", tone: "warning", icon: "sync" },
  deleted: { label: "Deleted", tone: "danger", icon: "trash" },
  claude: { label: "Changed by Claude", tone: "claude", icon: "claude" },
} as const satisfies Record<string, Word>;

export function ReviewBadge({ state, size: s }: { state: ReviewState; size?: "sm" | "md" }) {
  return <Badge {...REVIEW[state]} size={s} />;
}

export function SeverityBadge({ severity, size: s }: { severity: Severity; size?: "sm" | "md" }) {
  return <Badge {...SEVERITY[severity]} size={s} />;
}
