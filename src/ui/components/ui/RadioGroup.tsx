import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Checkbox } from "./Checkbox.tsx";

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s5 },
  label: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
});

export type RadioOption<V extends string> = {
  value: V;
  label: string;
  hint?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
};

type ForcedOption<V extends string> = { value: V; state: "hover" | "focus" };

export type RadioGroupProps<V extends string> = {
  /** null while nothing is chosen */
  value: V | null;
  options: RadioOption<V>[];
  onChange: (value: V) => void;
  /** the group's accessible name; shown above the choices only with `showLabel` */
  label: string;
  showLabel?: boolean;
  /** side by side instead of one under the other */
  inline?: boolean;
  /** every choice off, with the reason */
  disabled?: boolean | string;
  /** the catalogue only: the choice shown hovered or focused */
  debugState?: ForcedOption<V>;
};

// ponytail: one of N inside a form, as Checkbox radios sharing one name (the browser moves between them with the
// arrows); two to five visible views or modes are a Segmented choice instead (SYSTEM.md)
export function RadioGroup<V extends string>({
  value,
  options,
  onChange,
  label,
  showLabel = false,
  inline = false,
  disabled = false,
  debugState,
}: RadioGroupProps<V>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? `${name}-label` : undefined}
      {...stylex.props(styles.group)}
    >
      {showLabel && (
        <span id={`${name}-label`} {...stylex.props(styles.label)}>
          {label}
        </span>
      )}
      <div {...stylex.props(styles.group, inline && styles.row)}>
        {options.map((o) => (
          <Checkbox
            key={o.value}
            radio
            name={name}
            value={o.value}
            checked={o.value === value}
            label={o.label}
            hint={o.hint}
            disabled={disabled !== false ? disabled : (o.disabled ?? false)}
            onChange={() => onChange(o.value)}
            debugState={debugState?.value === o.value ? debugState.state : undefined}
          />
        ))}
      </div>
    </div>
  );
}
