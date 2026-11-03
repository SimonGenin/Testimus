import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef } from "react";
import { border, color, focus, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  row: {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: space.s3,
    minWidth: 0,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    color: color.text,
    cursor: "pointer",
  },
  rowDisabled: { color: color.textDisabled, cursor: "not-allowed" },
  boxWrap: { position: "relative", display: "inline-flex", flex: "none", marginTop: border.width },
  box: {
    boxSizing: "border-box",
    appearance: "none",
    flex: "none",
    width: size.iconMd,
    height: size.iconMd,
    margin: 0,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: { default: color.borderControl, ":hover": color.textMuted },
    borderRadius: radius.r1,
    backgroundColor: color.surface,
    cursor: "inherit",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  radio: { borderRadius: radius.full },
  on: { backgroundColor: color.accent, borderColor: color.accent },
  radioOn: {
    backgroundColor: color.surface,
    borderColor: color.accent,
    boxShadow: `inset 0 0 0 ${space.s2} ${color.accent}`,
  },
  disabled: { backgroundColor: color.surfaceSunken, borderColor: color.border },
  radioOnDisabled: { boxShadow: `inset 0 0 0 ${space.s2} ${color.textDisabled}` },
  forceHover: { borderColor: color.textMuted },
  forceFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  mark: {
    position: "absolute",
    inset: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: color.onAccent,
    pointerEvents: "none",
  },
  markDisabled: { color: color.textDisabled },
  small: { display: "inline-flex", transform: "scale(0.86)" },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  hint: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
});

export type CheckboxProps = {
  /** mixed: a group partly on (aria-checked="mixed"); a click turns it on */
  checked: boolean | "mixed";
  /** the new state; a radio only reports being chosen (true) */
  onChange: (checked: boolean) => void;
  /** says what is true when ticked (« Only with findings »); the accessible name */
  label: string;
  /** a second line under the label, read as the description */
  hint?: string;
  /** one of N inside a RadioGroup (the models folder: Move / Keep / Copy) */
  radio?: boolean;
  /** the radio group's name (RadioGroup sets it) or a form field's name */
  name?: string;
  value?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: a yes/no submitted with a form or a filter; the native input is the box (the keyboard, the form and the
// radio group's arrows come with it) — a setting that applies at once is a Switch (SYSTEM.md)
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  radio = false,
  name,
  value,
  disabled = false,
  debugState,
}: CheckboxProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const mixed = checked === "mixed" && !radio;
  const on = checked === true;
  const off = disabled !== false;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  const mark = !radio && (on || mixed) ? (mixed ? "minus" : "check") : null;
  const row = (
    <label {...stylex.props(styles.row, off && styles.rowDisabled)}>
      <span {...stylex.props(styles.boxWrap)}>
        <input
          ref={ref}
          type={radio ? "radio" : "checkbox"}
          checked={on}
          name={name}
          value={value}
          disabled={off}
          aria-labelledby={hint ? `${id}-label` : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          {...stylex.props(
            styles.box,
            radio && styles.radio,
            !off && debugState === "hover" && styles.forceHover,
            debugState === "focus" && styles.forceFocus,
            (on || mixed) && (radio ? styles.radioOn : styles.on),
            off && styles.disabled,
            off && radio && on && styles.radioOnDisabled,
          )}
        />
        {mark && (
          <span {...stylex.props(styles.mark, off && styles.markDisabled)}>
            <span {...stylex.props(styles.small)}>
              <Icon name={mark} size="sm" />
            </span>
          </span>
        )}
      </span>
      <span {...stylex.props(styles.text)}>
        <span id={`${id}-label`}>{label}</span>
        {hint && (
          <span id={`${id}-hint`} {...stylex.props(styles.hint)}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
  return typeof disabled === "string" ? <Tooltip label={disabled}>{row}</Tooltip> : row;
}
