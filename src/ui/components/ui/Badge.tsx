import * as stylex from "@stylexjs/stylex";
import { border, color, focus, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";
import { Tooltip } from "./Tooltip.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  badge: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    height: size.badge,
    paddingBlock: 0,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.pill,
    borderRadius: radius.full,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  },
  noIcon: { paddingInline: space.pill },
  neutral: { color: color.neutral, backgroundColor: color.neutralSubtle },
  info: { color: color.info, backgroundColor: color.infoSubtle },
  success: { color: color.success, backgroundColor: color.successSubtle },
  warning: { color: color.warning, backgroundColor: color.warningSubtle },
  danger: { color: color.danger, backgroundColor: color.dangerSubtle },
  claude: { color: color.claudeText, backgroundColor: color.claudeSubtle },
  accent: { color: color.accentText, backgroundColor: color.accentSubtle },
  outline: { backgroundColor: "transparent", boxShadow: `inset 0 0 0 ${border.width} currentColor` },
  quiet: { paddingInlineStart: 0, paddingInlineEnd: 0, backgroundColor: "transparent", color: color.textMuted },
  ring: { boxShadow: `inset 0 0 0 ${border.width} currentColor` },
  button: {
    margin: 0,
    borderWidth: 0,
    fontFamily: "inherit",
    cursor: "pointer",
    filter: { default: null, ":hover": "brightness(0.92)" },
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  sm: { height: size.badgeSm, paddingInline: space.s3 },
  count: {
    justifyContent: "center",
    minWidth: size.kbd,
    height: size.kbd,
    paddingInline: space.snug,
    borderRadius: radius.full,
    fontVariantNumeric: "tabular-nums",
  },
  countSm: { minWidth: size.iconMd, height: size.iconMd },
  dot: {
    width: size.dot,
    height: size.dot,
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
  statusDraft: { color: color.statusDraft },
  statusToFix: { color: color.statusToFix },
  statusValidated: { color: color.statusValidated },
  severityError: { color: color.severityError },
  severityWarning: { color: color.severityWarning },
  severityInfo: { color: color.severityInfo },
  diffAdded: { color: color.diffAdded },
  diffModified: { color: color.diffModified },
  diffRemoved: { color: color.diffRemoved },
  diffClaude: { color: color.diffClaude },
  dotStatusDraft: { backgroundColor: color.statusDraft },
  dotStatusToFix: { backgroundColor: color.statusToFix },
  dotStatusValidated: { backgroundColor: color.statusValidated },
  dotSeverityError: { backgroundColor: color.severityError },
  dotSeverityWarning: { backgroundColor: color.severityWarning },
  dotSeverityInfo: { backgroundColor: color.severityInfo },
  dotDiffAdded: { backgroundColor: color.diffAdded },
  dotDiffModified: { backgroundColor: color.diffModified },
  dotDiffRemoved: { backgroundColor: color.diffRemoved },
  dotDiffClaude: { backgroundColor: color.diffClaude },
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

// ponytail: the vocabularies' own colour aliases (tokens.css color-status-*, -severity-*, -diff-*): a word of REVIEW,
// SEVERITY or DIFF takes its alias for its word and icon, its tone for the ground — changing an alias in the design
// changes that word everywhere
export type Ink =
  | "statusDraft"
  | "statusToFix"
  | "statusValidated"
  | "severityError"
  | "severityWarning"
  | "severityInfo"
  | "diffAdded"
  | "diffModified"
  | "diffRemoved"
  | "diffClaude";

const INK_DOT = {
  statusDraft: styles.dotStatusDraft,
  statusToFix: styles.dotStatusToFix,
  statusValidated: styles.dotStatusValidated,
  severityError: styles.dotSeverityError,
  severityWarning: styles.dotSeverityWarning,
  severityInfo: styles.dotSeverityInfo,
  diffAdded: styles.dotDiffAdded,
  diffModified: styles.dotDiffModified,
  diffRemoved: styles.dotDiffRemoved,
  diffClaude: styles.dotDiffClaude,
} as const;

export type BadgeProps = {
  /** one or two words (« To fix », « In sync »), or the number of a count */
  label: string;
  /** a meaning, never a look: neutral (Draft, Local) · info (an info finding) · success (Validated, In sync) · warning (To
   * fix, Modified) · danger (Conflict, Error) · claude (Changed by Claude, Generated) · accent (a selected tab's count) */
  tone?: BadgeTone;
  /** set by a fixed vocabulary (REVIEW, SEVERITY, DIFF), never by a screen: the word's own colour alias */
  ink?: Ink;
  /** beside the word: the icon and the word carry the meaning, the tone repeats it */
  icon?: IconName;
  /** a state that is a link or a reference (« Jira version ») */
  outline?: boolean;
  /** a state that asks for no look (« Supported », « Confirmed », among others that do): the icon and the word alone,
   * muted, on no ground */
  quiet?: boolean;
  /** md 22 px (default) · sm 18 px, in dense meta lines and tab counts */
  size?: "sm" | "md";
  /** a number pill */
  count?: boolean;
  /** a state on an icon (the rail's system status): a dot whose label is read out */
  dot?: boolean;
  /** work in progress (Running, Indexing…): a spinner replaces the icon */
  busy?: boolean;
  /** more words on hover and focus */
  tooltip?: string;
  /** a state you can open (« Jira version »: the step as Jira has it): the badge is a button, drawn outline */
  onClick?: () => void;
  /** with onClick: what it opens is shown (aria-pressed) */
  pressed?: boolean;
};

// ponytail: a short state attached to a thing — the review state, a finding's severity, a sync state, a diff mark, a
// count; the fixed vocabularies below are the only words screens use for them
export function Badge({
  label,
  tone = "neutral",
  ink,
  icon,
  outline = false,
  quiet = false,
  size: s = "md",
  count = false,
  dot = false,
  busy = false,
  tooltip,
  onClick,
  pressed,
}: BadgeProps) {
  const badge = dot ? (
    <span role="img" aria-label={label} {...stylex.props(styles.badge, styles.dot, DOT[tone], ink && INK_DOT[ink])} />
  ) : onClick ? (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      {...stylex.props(
        s === "sm" ? type.caption : type.small,
        type.medium,
        styles.badge,
        styles.button,
        styles[tone],
        !icon && styles.noIcon,
        pressed ? styles.ring : styles.outline,
        s === "sm" && styles.sm,
      )}
    >
      {icon && <Icon name={icon} size="sm" />}
      {label}
    </button>
  ) : (
    <span
      aria-busy={busy || undefined}
      {...stylex.props(
        s === "sm" ? type.caption : type.small,
        type.medium,
        styles.badge,
        styles[tone],
        ink && styles[ink],
        !icon && !busy && styles.noIcon,
        outline && styles.outline,
        s === "sm" && styles.sm,
        quiet && styles.quiet,
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

export type Word = { label: string; tone: BadgeTone; icon?: IconName; ink?: Ink; tooltip?: string };

export type ReviewState = "draft" | "to-fix" | "validated";
export type Severity = "error" | "warning" | "info";

export const REVIEW: Record<ReviewState, Word> = {
  draft: { label: "Draft", tone: "neutral", icon: "circle-dashed", ink: "statusDraft" },
  "to-fix": { label: "To fix", tone: "warning", icon: "to-fix", ink: "statusToFix" },
  validated: { label: "Validated", tone: "success", icon: "validated", ink: "statusValidated" },
};

export const SEVERITY: Record<Severity, Word> = {
  error: { label: "Error", tone: "danger", icon: "x-circle", ink: "severityError" },
  warning: { label: "Warning", tone: "warning", icon: "alert-triangle", ink: "severityWarning" },
  info: { label: "Info", tone: "info", icon: "info", ink: "severityInfo" },
};

export const SYNC = {
  checking: { label: "Checking…", tone: "info", icon: "verify" },
  "in-sync": { label: "In sync", tone: "success", icon: "sync" },
  modified: { label: "Modified", tone: "warning", icon: "circle-dot", ink: "diffModified" },
  "changed-in-jira": { label: "Changed in Jira", tone: "warning", icon: "cloud" },
  conflict: { label: "Conflict", tone: "danger", icon: "conflict" },
  local: { label: "Local only", tone: "neutral", icon: "drive" },
} as const satisfies Record<string, Word>;

export const DIFF = {
  new: { label: "New", tone: "success", icon: "plus", ink: "diffAdded" },
  modified: { label: "Modified", tone: "warning", icon: "circle-dot", ink: "diffModified" },
  deleted: { label: "Deleted", tone: "danger", icon: "trash", ink: "diffRemoved" },
  claude: { label: "Changed by Claude", tone: "claude", icon: "claude", ink: "diffClaude" },
} as const satisfies Record<string, Word>;

// a step column's origin (Generate's columns, Settings › Columns and Claude's proposals): « Local only » is the sync
// word, so a local column reads the same everywhere
export const COLUMN = {
  xray: { label: "Xray", tone: "neutral" },
  standard: { label: "Xray · standard", tone: "neutral" },
  local: SYNC.local,
  "new-in-xray": {
    label: "Xray · to describe",
    tone: "warning",
    icon: "alert-triangle",
    tooltip: "A step field Testimus found in Xray. Claude fills it only once it is described.",
  },
  gone: { label: "No longer in Xray", tone: "warning", icon: "alert-triangle" },
  "new-local": { label: "New local column", tone: "success", icon: "plus" },
} as const satisfies Record<string, Word>;

// a document's status (the documents list, a source's head)
export const DOC_STATUS = {
  draft: REVIEW.draft,
  submitted: { label: "Submitted", tone: "info", icon: "upload" },
  validated: REVIEW.validated,
} as const satisfies Record<string, Word>;

// a test's result in a test run (the Run screen, its pages)
export const RUN_STATUS = {
  passed: { label: "Passed", tone: "success", icon: "check-circle" },
  problem: { label: "Problem", tone: "danger", icon: "x-circle" },
  blocked: { label: "Blocked", tone: "warning", icon: "alert-triangle" },
  "not-run": { label: "Not run", tone: "neutral", icon: "circle-dashed" },
} as const satisfies Record<string, Word>;

// a tester's question on a test of a run
export const QUESTION = {
  open: { label: "Open", tone: "warning", icon: "circle-dot" },
  answered: { label: "Answered", tone: "success", icon: "check-circle" },
} as const satisfies Record<string, Word>;

// a check of the System check (doctor) and of a pack's verification
export const HEALTH = {
  fail: { label: "Failed", tone: "danger", icon: "x-circle" },
  warn: { label: "To do", tone: "warning", icon: "alert-triangle" },
  ok: { label: "OK", tone: "success", icon: "check-circle" },
  skip: { label: "Not checked", tone: "neutral", icon: "circle-dashed" },
  info: { label: "Info", tone: "info", icon: "info" },
} as const satisfies Record<string, Word>;

// what one proposal of Claude's analysis of a test does, and where it stands (Tests › Analysis)
export const PROPOSAL = {
  source: { label: "Source", tone: "accent", icon: "quote" },
  change: { label: "Change", tone: "warning", icon: "circle-dot", ink: "diffModified" },
  step: { label: "New step", tone: "success", icon: "plus", ink: "diffAdded" },
  remove: { label: "Remove", tone: "danger", icon: "trash", ink: "diffRemoved" },
  accepted: { label: "Accepted", tone: "success", icon: "check" },
  rejected: { label: "Rejected", tone: "neutral", icon: "close" },
  stale: { label: "Out of date", tone: "warning", icon: "alert-triangle" },
} as const satisfies Record<string, Word>;

// how Claude's analysis treats a step column
export const COLUMN_ROLE = {
  keep: { label: "Kept as written", tone: "neutral", icon: "lock" },
  open: { label: "Open to changes", tone: "claude" },
  leave: { label: "Left empty", tone: "neutral", icon: "minus" },
} as const satisfies Record<string, Word>;

// ponytail: what the check says of one step, findings or not (Review) — and Testimus' own word when the run never
// opened the passages it names: the verdict is then no proof
export const STEP_VERDICT = {
  supported: { label: "Supported", tone: "success", icon: "check" },
  unsupported: { label: "Unsupported", tone: "danger", icon: "x-circle" },
  unverified: { label: "Not verified", tone: "warning", icon: "circle-dashed" },
  "not-opened": {
    label: "Not opened during the check",
    tone: "warning",
    icon: "alert-triangle",
    tooltip: "Testimus saw no call of the check that opened the passages it names: this verdict is no proof.",
  },
} as const satisfies Record<string, Word>;

// ponytail: a behavior a generation left without a test — the second look Claude took at its reason while checking,
// and what Testimus itself could not confirm about it
export const SECOND_LOOK = {
  confirmed: { label: "Confirmed", tone: "success", icon: "check" },
  writable: { label: "Can be written", tone: "warning", icon: "generate" },
  unsure: { label: "Unsure", tone: "neutral", icon: "circle-dashed" },
  doubt: { label: "Doubt", tone: "warning", icon: "alert-triangle" },
} as const satisfies Record<string, Word>;

// ponytail: a Jira status is Jira's own word, so it is not a fixed list: its meaning is read from the word — done
// (Done, Closed, Ready, Passed), under way (In progress, In review, Blocked), else waiting (To Do, Open) — one rule for
// the tests list and the test's head
export function jiraStatus(status: string): Word {
  if (/done|ready|closed|pass/i.test(status)) return { label: status, tone: "success", icon: "check-circle" };
  if (/review|progress|block/i.test(status)) return { label: status, tone: "warning", icon: "clock" };
  return { label: status, tone: "neutral", icon: "circle-dashed" };
}

// ponytail: a state the page does not know (an older run's `checked`, a result with none) reads as draft, never as an
// empty badge
export function ReviewBadge({ state, size: s }: { state: ReviewState; size?: "sm" | "md" }) {
  return <Badge {...(REVIEW[state] ?? REVIEW.draft)} size={s} />;
}

export function SeverityBadge({ severity, size: s }: { severity: Severity; size?: "sm" | "md" }) {
  return <Badge {...SEVERITY[severity]} size={s} />;
}
