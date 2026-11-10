import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactElement, ReactNode, Ref } from "react";
import {
  border,
  color,
  focus,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import type { BadgeTone } from "./Badge.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  item: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    width: size.railItem,
    margin: 0,
    paddingTop: space.pill,
    paddingBottom: space.s2,
    paddingInline: space.snug,
    borderWidth: 0,
    borderRadius: radius.r3,
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    fontFamily: "inherit",
    fontSize: fontSize.rail,
    lineHeight: lineHeight.railLabel,
    fontWeight: fontWeight.medium,
    textAlign: "center",
    textDecoration: "none",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  current: {
    backgroundColor: { default: color.surface, ":hover": color.surface },
    color: color.text,
    boxShadow: `${shadow.s1}, 0 0 0 ${border.width} ${color.border}`,
  },
  avatarItem: { gap: space.s1, paddingTop: space.s2 },
  dotItem: { gap: `calc(${space.s1} + ${border.width})`, paddingTop: space.s2 },
  hover: { backgroundColor: color.surfaceHover, color: color.text },
  focus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  icon: { display: "inline-flex" },
  iconCurrent: { color: color.accentText },
  label: { maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  labelWrap: { whiteSpace: "normal" },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.micro, lineHeight: lineHeight.micro },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlMd,
    height: size.controlMd,
    borderRadius: radius.r2,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
  },
  count: {
    position: "absolute",
    top: space.s1,
    right: space.s4,
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size.iconMd,
    height: size.iconMd,
    paddingInline: space.snug,
    borderRadius: radius.full,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
  },
  compact: {
    justifyContent: "center",
    gap: 0,
    width: size.controlMd,
    height: size.controlMd,
    paddingTop: 0,
    paddingBottom: 0,
    paddingInline: 0,
    borderRadius: radius.r2,
  },
  countCompact: { top: `calc(-1 * ${space.s1})`, right: `calc(-1 * ${space.s1})` },
  dot: { width: size.statusDot, height: size.statusDot, borderRadius: radius.full },
  neutral: { backgroundColor: color.neutral },
  info: { backgroundColor: color.info },
  success: { backgroundColor: color.success },
  warning: { backgroundColor: color.warning },
  danger: { backgroundColor: color.danger },
  claude: { backgroundColor: color.claude },
  accent: { backgroundColor: color.accent },
});

export type RailItemProps = {
  /** the word under the icon (« Documents », « System ») */
  label: string;
  icon?: IconName;
  /** the screen shown now: aria-current="page" and the raised look */
  current?: boolean;
  /** how many wait there (a small accent pill, top right) */
  count?: number;
  /** initials in a tile in place of the icon (the project) */
  avatar?: string;
  /** a state dot in place of the icon (the system status); the label says the state, on two lines if it needs them */
  dot?: BadgeTone;
  /** the label in mono, small (a project key) */
  mono?: boolean;
  /** a link to a screen (`#/tests`); without it, a button */
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  /** a menu or popover trigger (the project menu) */
  popup?: { kind: "menu" | "dialog"; open: boolean; controls?: string };
  /** said instead of the label when it needs more words (« Review, 3 waiting ») */
  ariaLabel?: string;
  /** the icon alone (the rail is icons only): the label is its name and its tooltip */
  compact?: boolean;
  /** compact only: no tooltip of its own (a menu's trigger, which the menu wraps) */
  noTooltip?: boolean;
  ref?: Ref<HTMLButtonElement & HTMLAnchorElement>;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: a destination in the left rail — a link to a screen, or a button that opens the project menu or the
// system check; not a Button option: an icon over a word, a pill and a raised « current » make it its own control
export function RailItem({
  label,
  icon,
  current = false,
  count,
  avatar,
  dot,
  mono = false,
  href,
  onClick,
  popup,
  ariaLabel,
  compact = false,
  noTooltip = false,
  ref,
  debugState,
}: RailItemProps) {
  const look = stylex.props(
    styles.item,
    !compact && avatar !== undefined && styles.avatarItem,
    !compact && avatar === undefined && dot !== undefined && styles.dotItem,
    compact && styles.compact,
    current && styles.current,
    debugState === "hover" && styles.hover,
    debugState === "focus" && styles.focus,
  );
  const body: ReactNode = (
    <>
      {avatar ? (
        <span aria-hidden="true" {...stylex.props(styles.avatar)}>
          {avatar}
        </span>
      ) : dot ? (
        <span aria-hidden="true" {...stylex.props(styles.dot, styles[dot])} />
      ) : (
        icon && (
          <span {...stylex.props(styles.icon, current && styles.iconCurrent)}>
            <Icon name={icon} size="lg" />
          </span>
        )
      )}
      {!compact && (
        <span {...stylex.props(styles.label, mono && styles.mono, dot !== undefined && styles.labelWrap)}>{label}</span>
      )}
      {count !== undefined && count > 0 && (
        <span aria-hidden="true" {...stylex.props(styles.count, compact && styles.countCompact)}>
          {count}
        </span>
      )}
    </>
  );
  const name = ariaLabel ?? (count ? `${label}, ${count}` : compact ? label : undefined);
  const tip = (el: ReactElement<{ "aria-describedby"?: string }>) =>
    compact && !noTooltip ? (
      <Tooltip label={label} side="right">
        {el}
      </Tooltip>
    ) : (
      el
    );
  if (href)
    return tip(
      <a
        ref={ref}
        href={href}
        aria-current={current ? "page" : undefined}
        aria-label={name}
        onClick={onClick}
        {...look}
      >
        {body}
      </a>,
    );
  return tip(
    <button
      ref={ref}
      type="button"
      aria-current={current ? "page" : undefined}
      aria-label={name}
      aria-haspopup={popup?.kind}
      aria-expanded={popup?.open}
      aria-controls={popup?.controls}
      onClick={onClick}
      {...look}
    >
      {body}
    </button>,
  );
}
