import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactNode, Ref } from "react";
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

const styles = stylex.create({
  item: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: `calc(${space.s1} + ${border.width})`,
    width: size.railItem,
    margin: 0,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: radius.r2,
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    fontFamily: "inherit",
    fontSize: fontSize.caption,
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
    boxShadow: `${shadow.s1}, inset 0 0 0 ${border.width} ${color.border}`,
  },
  hover: { backgroundColor: color.surfaceHover, color: color.text },
  focus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  icon: { display: "inline-flex" },
  iconCurrent: { color: color.accentText },
  label: { maxWidth: size.railItem, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.micro, lineHeight: lineHeight.micro },
  small: { fontSize: fontSize.micro, lineHeight: lineHeight.micro },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.row,
    height: size.row,
    borderRadius: radius.r2,
    backgroundColor: color.text,
    color: color.canvas,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    letterSpacing: "0.02em",
  },
  count: {
    position: "absolute",
    top: space.s1,
    right: `calc(${space.s2} + ${space.s1})`,
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size.iconMd,
    height: size.iconMd,
    paddingInline: space.s1,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    color: color.onAccent,
    fontSize: fontSize.micro,
    fontVariantNumeric: "tabular-nums",
  },
  dot: { width: size.knob, height: size.knob, borderRadius: radius.full },
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
  /** a state dot in place of the icon (the system status); the label says the state */
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
  ref,
  debugState,
}: RailItemProps) {
  const look = stylex.props(
    styles.item,
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
      <span {...stylex.props(styles.label, mono && styles.mono, dot !== undefined && styles.small)}>{label}</span>
      {count !== undefined && count > 0 && (
        <span aria-hidden="true" {...stylex.props(styles.count)}>
          {count}
        </span>
      )}
    </>
  );
  const name = ariaLabel ?? (count ? `${label}, ${count}` : undefined);
  if (href)
    return (
      <a
        ref={ref}
        href={href}
        aria-current={current ? "page" : undefined}
        aria-label={name}
        onClick={onClick}
        {...look}
      >
        {body}
      </a>
    );
  return (
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
    </button>
  );
}
