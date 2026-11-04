import * as stylex from "@stylexjs/stylex";
import { type MouseEvent, type Ref, useRef } from "react";
import {
  border,
  color,
  duration,
  easing,
  focus,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import { Spinner } from "./Spinner.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  base: {
    boxSizing: "border-box",
    fontStyle: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.snug,
    flexShrink: 0,
    height: size.controlMd,
    margin: 0,
    paddingBlock: 0,
    paddingInline: space.button,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderField,
    borderRadius: radius.r2,
    backgroundColor: { default: color.surface, ":hover": color.surfaceHover, ":active": color.surfacePressed },
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    textAlign: "center",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: duration.instant,
    transitionTimingFunction: easing.standard,
    boxShadow: shadow.s0,
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  filled: { boxShadow: `${shadow.s0}, inset 0 1px 0 ${color.sheen}` },
  flat: { boxShadow: "none" },
  primary: {
    backgroundColor: { default: color.accent, ":hover": color.accentHover, ":active": color.accentPressed },
    borderColor: { default: color.accent, ":hover": color.accentHover, ":active": color.accentPressed },
    color: color.onAccent,
  },
  secondary: {},
  quiet: {
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover, ":active": color.surfacePressed },
    borderColor: "transparent",
    color: { default: color.textMuted, ":hover": color.text, ":active": color.text },
  },
  danger: {
    backgroundColor: { default: color.dangerFill, ":hover": color.danger, ":active": color.danger },
    borderColor: { default: color.dangerFill, ":hover": color.danger, ":active": color.danger },
    color: color.onDanger,
    filter: { default: null, ":hover": "brightness(0.92)", ":active": "brightness(0.92)" },
  },
  claude: {
    backgroundColor: { default: color.claude, ":hover": color.claudeHover, ":active": color.claudeHover },
    borderColor: { default: color.claude, ":hover": color.claudeHover, ":active": color.claudeHover },
    color: color.onClaude,
  },
  claudeQuiet: {
    backgroundColor: { default: "transparent", ":hover": color.claudeSubtle, ":active": color.claudeSubtle },
    borderColor: "transparent",
    color: color.claudeText,
  },
  field: {
    justifyContent: "flex-start",
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    backgroundColor: { default: color.surfaceSunken, ":hover": color.surfaceHover, ":active": color.surfacePressed },
    borderColor: "transparent",
    color: { default: color.textSubtle, ":hover": color.textMuted },
    fontWeight: fontWeight.regular,
  },
  fieldHover: { backgroundColor: color.surfaceHover, color: color.textMuted },
  kbdEnd: { marginInlineStart: "auto", marginInlineEnd: 0 },
  xs: {
    height: size.controlXs,
    paddingInline: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    borderRadius: radius.r1,
  },
  sm: { height: size.controlSm, paddingInline: space.s3, fontSize: fontSize.small, lineHeight: lineHeight.small },
  md: {},
  lg: { height: size.controlLg, paddingInline: space.s5, fontSize: fontSize.body, lineHeight: lineHeight.body },
  square: { paddingInline: 0 },
  squareXs: { width: size.controlXs },
  squareSm: { width: size.controlSm },
  squareMd: { width: size.controlMd },
  squareLg: { width: size.controlLg },
  block: { width: "100%" },
  disabled: {
    backgroundColor: color.surfaceSunken,
    borderColor: "transparent",
    color: color.textDisabled,
    filter: null,
    boxShadow: "none",
    cursor: "not-allowed",
  },
  disabledQuiet: { backgroundColor: "transparent" },
  loading: { cursor: "progress" },
  count: { fontVariantNumeric: "tabular-nums", opacity: 0.8, fontWeight: fontWeight.regular },
  primaryHover: { backgroundColor: color.accentHover, borderColor: color.accentHover },
  primaryPressed: { backgroundColor: color.accentPressed, borderColor: color.accentPressed },
  secondaryHover: { backgroundColor: color.surfaceHover },
  secondaryPressed: { backgroundColor: color.surfacePressed },
  quietHover: { backgroundColor: color.surfaceHover, color: color.text },
  quietPressed: { backgroundColor: color.surfacePressed, color: color.text },
  dangerHover: { backgroundColor: color.danger, borderColor: color.danger, filter: "brightness(0.92)" },
  claudeHover: { backgroundColor: color.claudeHover, borderColor: color.claudeHover },
  claudeQuietHover: { backgroundColor: color.claudeSubtle },
  focusRing: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  ringOnFocus: { outline: { default: "none", ":focus": `${border.widthStrong} solid ${color.focusRing}` } },
  kbd: { marginInlineStart: space.s2, marginInlineEnd: `calc(-1 * ${space.s2})` },
  hiddenInput: { display: "none" },
});

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "claude" | "claude-quiet" | "field";

export type ButtonProps = {
  /** primary: the screen region's one action · secondary (default) · quiet: toolbars and rows · danger: the confirm
   * of a destructive dialog only · claude / claude-quiet: starts a Claude run · field: a sunken pill that opens a
   * search (the top bar's palette, Ctrl K): words on the left, its shortcut at the right end */
  variant?: ButtonVariant;
  /** xs 24 px (icon-only row actions) · sm 28 px (cards, rows, toasts, the dock's footer) · md 32 px · lg 40 px */
  size?: "xs" | "sm" | "md" | "lg";
  /** a verb in sentence case (« Push to Jira »); with iconOnly it becomes the accessible name and the tooltip */
  label: string;
  icon?: IconName;
  iconAfter?: IconName;
  /** square, the icon alone; the label is read out and shown as a tooltip */
  iconOnly?: boolean;
  count?: number | string;
  /** a timed action's seconds left, shown after the label (« Undo · 5 s ») but kept out of its name */
  countdown?: number;
  /** shown as keys, on a screen's primary action only (Validate · V) */
  shortcut?: string;
  /** a spinner replaces the icon, the label stays, aria-busy; clicks are ignored */
  loading?: boolean;
  /** true, or the reason (« Claude is working — wait for it to finish »), shown as a tooltip */
  disabled?: boolean | string;
  /** full width of its container */
  block?: boolean;
  /** a toggle's state (aria-pressed), drawn pressed while on */
  pressed?: boolean;
  /** the focus ring shows whenever it has the focus, also when the program put it there (a confirmation's Cancel) */
  ringOnFocus?: boolean;
  /** a fold's trigger (« Show details »): aria-expanded, with a chevron after the label */
  expanded?: boolean;
  /** a menu or popover trigger: what it opens and whether it is open */
  popup?: { kind: "menu" | "dialog" | "listbox"; open: boolean; controls?: string };
  type?: "button" | "submit";
  /** the button opens the system's file picker (an image for a step, documents to add, files for a context) */
  pick?: { accept?: string; multiple?: boolean; onFiles: (files: File[]) => void };
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
  "data-testid"?: string;
  /** the catalogue only: shows hover, pressed or focus without the pointer */
  debugState?: DebugState;
};

const VARIANT = {
  primary: styles.primary,
  secondary: styles.secondary,
  quiet: styles.quiet,
  danger: styles.danger,
  claude: styles.claude,
  "claude-quiet": styles.claudeQuiet,
  field: styles.field,
} as const;

const SQUARE = { xs: styles.squareXs, sm: styles.squareSm, md: styles.squareMd, lg: styles.squareLg } as const;

const FORCED = {
  hover: {
    primary: styles.primaryHover,
    secondary: styles.secondaryHover,
    quiet: styles.quietHover,
    danger: styles.dangerHover,
    claude: styles.claudeHover,
    "claude-quiet": styles.claudeQuietHover,
    field: styles.fieldHover,
  },
  pressed: {
    primary: styles.primaryPressed,
    secondary: styles.secondaryPressed,
    quiet: styles.quietPressed,
    danger: styles.dangerHover,
    claude: styles.claudeHover,
    "claude-quiet": styles.claudeQuietHover,
    field: styles.fieldHover,
  },
} as const;

// ponytail: the #/kit catalogue shows each state side by side, so a state the pointer or the keyboard gives can be
// set by the catalogue (screens/kit only)
export type DebugState = "hover" | "pressed" | "focus" | "open";

export function Button({
  variant = "secondary",
  size: s = "md",
  label,
  icon,
  iconAfter,
  iconOnly = false,
  count,
  countdown,
  shortcut,
  loading = false,
  disabled = false,
  block = false,
  pressed,
  ringOnFocus = false,
  expanded,
  popup,
  pick,
  type = "button",
  onClick,
  ref,
  "data-testid": testId,
  debugState,
}: ButtonProps) {
  const off = disabled !== false;
  const quietish = variant === "quiet" || variant === "claude-quiet" || variant === "field";
  const filled = variant === "primary" || variant === "danger" || variant === "claude";
  const fileInput = useRef<HTMLInputElement | null>(null);
  const button = (
    <button
      ref={ref}
      type={type}
      disabled={off}
      aria-label={iconOnly ? label : undefined}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      aria-haspopup={popup?.kind}
      aria-expanded={popup?.open ?? expanded}
      aria-controls={popup?.controls}
      data-testid={testId}
      onClick={(e) => {
        if (loading) return;
        onClick?.(e);
        if (pick) fileInput.current?.click();
      }}
      {...stylex.props(
        styles.base,
        VARIANT[variant],
        styles[s],
        filled && styles.filled,
        quietish && styles.flat,
        iconOnly && styles.square,
        iconOnly && SQUARE[s],
        block && styles.block,
        loading && styles.loading,
        !off && (pressed || popup?.open) && FORCED.pressed[variant],
        !off && (debugState === "hover" || debugState === "pressed") && FORCED[debugState][variant],
        ringOnFocus && styles.ringOnFocus,
        debugState === "focus" && styles.focusRing,
        off && styles.disabled,
        off && quietish && styles.disabledQuiet,
      )}
    >
      {loading ? <Spinner size={s === "xs" || s === "sm" ? "sm" : "md"} /> : icon && <Icon name={icon} />}
      {!iconOnly && label}
      {!iconOnly && count !== undefined && <span {...stylex.props(styles.count)}>{count}</span>}
      {!iconOnly && countdown !== undefined && <span aria-hidden="true">· {countdown} s</span>}
      {!iconOnly && (iconAfter || expanded !== undefined) && (
        <Icon name={iconAfter ?? (expanded ? "chevron-up" : "chevron-down")} />
      )}
      {!iconOnly && shortcut && (
        <span {...stylex.props(styles.kbd, variant === "field" && styles.kbdEnd)}>
          <Kbd onFill={variant !== "field"}>{shortcut}</Kbd>
        </span>
      )}
    </button>
  );
  const tip = typeof disabled === "string" ? disabled : iconOnly ? label : null;
  const shown = tip ? (
    <Tooltip label={tip} shortcut={iconOnly ? shortcut : undefined}>
      {button}
    </Tooltip>
  ) : (
    button
  );
  if (!pick) return shown;
  return (
    <>
      {shown}
      <input
        ref={fileInput}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept={pick.accept}
        multiple={pick.multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) pick.onFiles(files);
        }}
        {...stylex.props(styles.hiddenInput)}
      />
    </>
  );
}
