import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import { border, color, focus, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const FOCUS = `0 0 0 ${border.width} ${color.focusRing}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.focusRing} 18%, transparent)`;

const styles = stylex.create({
  wrap: { position: "relative", display: "inline-flex", alignItems: "center", minWidth: 0 },
  block: { display: "flex", width: "100%" },
  label: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  select: {
    boxSizing: "border-box",
    appearance: "none",
    flex: 1,
    minWidth: 0,
    height: size.controlMd,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s4,
    paddingInlineEnd: `calc(${space.s3} + ${size.iconSm} + ${space.s2})`,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: { default: color.borderField, ":hover": color.borderControl, ":focus-visible": color.focusRing },
    boxShadow: { default: null, ":focus-visible": FOCUS },
    borderRadius: radius.r2,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: "none",
  },
  quiet: {
    borderColor: { default: "transparent", ":hover": "transparent", ":focus-visible": color.focusRing },
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    paddingInlineStart: space.s2,
  },
  sm: { height: size.controlSm, fontSize: fontSize.small },
  withLead: { paddingInlineStart: `calc(${space.s4} + ${size.iconMd} + ${space.s2})` },
  withPrefix: { paddingInlineStart: space.s1 },
  disabled: {
    backgroundColor: color.surfaceSunken,
    borderColor: color.border,
    boxShadow: "none",
    color: color.textDisabled,
    cursor: "not-allowed",
  },
  lead: {
    position: "absolute",
    insetInlineStart: space.s4,
    display: "inline-flex",
    color: color.textMuted,
    pointerEvents: "none",
  },
  prefix: { paddingInlineStart: space.s4, color: color.textMuted, fontSize: fontSize.compact, whiteSpace: "nowrap" },
  chevron: {
    position: "absolute",
    insetInlineEnd: space.s3,
    display: "inline-flex",
    color: color.textMuted,
    pointerEvents: "none",
  },
  forceHover: { borderColor: color.borderControl },
  forceFocus: { borderColor: color.focusRing, boxShadow: FOCUS },
});

export type SelectOption<V extends string> = { value: V; label: string; disabled?: boolean };

export type SelectProps<V extends string> = {
  /** the field's id, when a label outside names it (htmlFor) */
  id?: string;
  value: V | null;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  /** the accessible name; shown above the field only with `showLabel` */
  label: string;
  showLabel?: boolean;
  /** boxed (forms) · quiet (toolbars, the dock footer, a sort) */
  appearance?: "boxed" | "quiet";
  size?: "sm" | "md";
  /** a word before the value (« Sort », « Folder ») */
  prefix?: string;
  icon?: IconName;
  /** shown while nothing is chosen (« Choose a folder… ») */
  placeholder?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  block?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: one value from a short known list; the list is the platform's own (accessible, keyboard) — more than about
// twelve values or free text is a Text with suggestions, two values a Segmented choice or a Switch (SYSTEM.md)
export function Select<V extends string>({
  id: givenId,
  value,
  options,
  onChange,
  label,
  showLabel = false,
  appearance = "boxed",
  size: s = "md",
  prefix,
  icon,
  placeholder,
  disabled = false,
  block = false,
  debugState,
}: SelectProps<V>) {
  const auto = useId();
  const id = givenId ?? auto;
  const off = disabled !== false;
  const field = (
    <span {...stylex.props(styles.wrap, block && styles.block)}>
      {prefix && (
        <span aria-hidden="true" {...stylex.props(styles.prefix)}>
          {prefix}
        </span>
      )}
      {icon && !prefix && (
        <span {...stylex.props(styles.lead)}>
          <Icon name={icon} />
        </span>
      )}
      <select
        id={id}
        aria-label={showLabel ? undefined : label}
        value={value ?? ""}
        disabled={off}
        onChange={(e) => onChange(e.target.value as V)}
        {...stylex.props(
          styles.select,
          appearance === "quiet" && styles.quiet,
          s === "sm" && styles.sm,
          icon && !prefix && styles.withLead,
          prefix !== undefined && styles.withPrefix,
          debugState === "hover" && styles.forceHover,
          debugState === "focus" && styles.forceFocus,
          off && styles.disabled,
        )}
      >
        {value === null && (
          <option value="" disabled>
            {placeholder ?? "Choose…"}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span {...stylex.props(styles.chevron)}>
        <Icon name="chevron-down" size="sm" />
      </span>
    </span>
  );
  const shown = typeof disabled === "string" ? <Tooltip label={disabled}>{field}</Tooltip> : field;
  if (!showLabel) return shown;
  return (
    <span {...stylex.props(styles.wrap, block && styles.block)}>
      <label htmlFor={id} {...stylex.props(styles.label)}>
        {label}
      </label>
      {shown}
    </span>
  );
}
