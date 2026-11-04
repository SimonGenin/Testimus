import * as stylex from "@stylexjs/stylex";
import { border, color, fontFamily, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";

const styles = stylex.create({
  chip: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    maxWidth: "100%",
    height: size.controlSm,
    margin: 0,
    paddingBlock: 0,
    paddingInline: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderField,
    borderRadius: radius.full,
    backgroundColor: { default: color.surface, ":hover": color.surfaceHover },
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.width,
  },
  still: { cursor: "default", backgroundColor: color.surface },
  label: { overflow: "hidden", textOverflow: "ellipsis" },
  icon: { display: "inline-flex", color: color.textMuted },
  on: {
    backgroundColor: color.accentSubtle,
    borderColor: `color-mix(in srgb, ${color.accent} 55%, transparent)`,
    color: color.accentText,
  },
  onIcon: { color: color.accentText },
  claudeOn: { backgroundColor: color.claudeSubtle, borderColor: color.claudeBorder, color: color.claudeText },
  claudeIcon: { color: color.claudeText },
  off: {
    color: color.textSubtle,
    textDecoration: "line-through",
    borderColor: color.border,
    backgroundColor: "transparent",
  },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
  square: { borderRadius: radius.r1, height: size.controlXs, paddingInline: space.s2 },
  disabled: { cursor: "not-allowed", color: color.textDisabled, backgroundColor: color.surfaceSunken },
  remove: {
    display: "inline-flex",
    margin: 0,
    marginInlineEnd: `calc(-1 * ${space.s2})`,
    padding: border.width,
    borderWidth: 0,
    borderRadius: radius.full,
    backgroundColor: { default: "transparent", ":hover": color.surfacePressed },
    color: { default: color.textSubtle, ":hover": color.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
  },
  forceHover: { backgroundColor: color.surfaceHover },
  inField: {
    height: size.controlXs,
    paddingInline: space.s3,
    borderRadius: radius.full,
    backgroundColor: color.neutralSubtle,
    borderColor: "transparent",
  },
  dot: { color: color.accent, fontSize: fontSize.small, lineHeight: 1 },
});

export type ChipProps = {
  label: string;
  /** a toggle (quick asks, a run's contexts, filters): on or off, aria-pressed */
  pressed?: boolean;
  onToggle?: () => void;
  /** a value in a set (labels, covers, preconditions): shows a remove button */
  onRemove?: () => void;
  /** the remove button's name when « Remove <label> » does not say what it does (« Leave Glossaire out of this run ») */
  removeLabel?: string;
  /** claude: something Claude reads (contexts, quick asks) */
  tone?: "neutral" | "claude";
  /** shown struck through when a toggle is off (a context left out of this run) */
  strikeOff?: boolean;
  /** keys and ids */
  mono?: boolean;
  /** inside a field */
  square?: boolean;
  /** a value inside a chip field (a 24 px neutral pill without an edge) */
  inField?: boolean;
  /** a chip that opens or does something without being a toggle (a folded column « Data ● ») */
  onClick?: () => void;
  /** a dot after the label: something is there (a folded column that holds text) */
  dot?: boolean;
  icon?: IconName;
  disabled?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: a small value you press or remove — never a status (that is a Badge), never a main action (a Button)
export function Chip({
  label,
  pressed,
  onToggle,
  onRemove,
  removeLabel,
  tone = "neutral",
  strikeOff = false,
  mono = false,
  square = false,
  inField = false,
  onClick,
  dot = false,
  icon,
  disabled = false,
  debugState,
}: ChipProps) {
  const toggle = onToggle !== undefined;
  const pressable = toggle || onClick !== undefined;
  const on = toggle && pressed === true;
  const look = stylex.props(
    styles.chip,
    !pressable && styles.still,
    on && (tone === "claude" ? styles.claudeOn : styles.on),
    toggle && pressed === false && strikeOff && styles.off,
    mono && styles.mono,
    square && styles.square,
    inField && styles.inField,
    disabled && styles.disabled,
    debugState === "hover" && styles.forceHover,
  );
  const inner = (
    <>
      {icon && (
        <span {...stylex.props(styles.icon, on && (tone === "claude" ? styles.claudeIcon : styles.onIcon))}>
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span {...stylex.props(styles.label)}>{label}</span>
      {dot && (
        <span aria-hidden="true" {...stylex.props(styles.dot)}>
          ●
        </span>
      )}
    </>
  );
  if (toggle)
    return (
      <button type="button" aria-pressed={pressed === true} disabled={disabled} onClick={onToggle} {...look}>
        {inner}
      </button>
    );
  if (onClick)
    return (
      <button type="button" disabled={disabled} onClick={onClick} {...look}>
        {inner}
      </button>
    );
  return (
    <span {...look}>
      {inner}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${label}`}
          disabled={disabled}
          onClick={onRemove}
          {...stylex.props(styles.remove)}
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </span>
  );
}
