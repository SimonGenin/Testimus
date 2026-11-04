import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import {
  border,
  color,
  duration,
  easing,
  focus,
  fontSize,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  wrap: { display: "inline-flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  switch: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    textAlign: "start",
    cursor: "pointer",
    outline: "none",
  },
  switchDisabled: { color: color.textDisabled, cursor: "not-allowed" },
  track: {
    boxSizing: "border-box",
    position: "relative",
    flex: "none",
    width: size.switchWidth,
    height: size.switchHeight,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderControl,
    borderRadius: radius.full,
    backgroundColor: color.surface,
    transitionProperty: "background-color",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
    outline: {
      default: "none",
      [stylex.when.ancestor(":focus-visible")]: `${border.widthStrong} solid ${color.focusRing}`,
    },
    outlineOffset: focus.offset,
  },
  trackOn: { backgroundColor: color.accent, borderColor: color.accent },
  trackDisabled: { backgroundColor: color.surfaceSunken, borderColor: color.border },
  forceFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  knob: {
    position: "absolute",
    top: space.s1,
    left: space.s1,
    width: size.knob,
    height: size.knob,
    borderRadius: radius.full,
    backgroundColor: color.textMuted,
    transitionProperty: "transform",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
  },
  knobOn: {
    transform: `translateX(calc(${size.switchWidth} - ${size.knob} - 2 * ${space.s1} - 2 * ${border.width}))`,
    backgroundColor: color.onAccent,
  },
  knobDisabled: { backgroundColor: color.textDisabled },
  hint: {
    paddingInlineStart: `calc(${size.switchWidth} + ${space.s3})`,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textSubtle,
  },
});

export type SwitchProps = {
  on: boolean;
  /** the new state; the setting applies at once (a command), never through a form's Save */
  onChange: (on: boolean) => void;
  /** describes the on state (« Always on top »), shown on the right; the accessible name */
  label: string;
  /** a second line under the label, read as the description */
  hint?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  /** the catalogue only */
  debugState?: "focus";
};

// ponytail: a setting that takes effect immediately (role=switch); a yes/no submitted with a form is a Checkbox
export function Switch({ on, onChange, label, hint, disabled = false, debugState }: SwitchProps) {
  const id = useId();
  const off = disabled !== false;
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-describedby={hint ? `${id}-hint` : undefined}
      disabled={off}
      onClick={() => onChange(!on)}
      {...stylex.props(stylex.defaultMarker(), styles.switch, off && styles.switchDisabled)}
    >
      <span
        {...stylex.props(
          styles.track,
          on && styles.trackOn,
          off && styles.trackDisabled,
          debugState === "focus" && styles.forceFocus,
        )}
      >
        <span {...stylex.props(styles.knob, on && styles.knobOn, off && styles.knobDisabled)} />
      </span>
      <span>{label}</span>
    </button>
  );
  const shown = typeof disabled === "string" ? <Tooltip label={disabled}>{button}</Tooltip> : button;
  if (!hint) return shown;
  return (
    <span {...stylex.props(styles.wrap)}>
      {shown}
      <span id={`${id}-hint`} {...stylex.props(styles.hint)}>
        {hint}
      </span>
    </span>
  );
}
