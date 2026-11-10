import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, container, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.snug, minWidth: 0 },
  label: { display: "flex", alignItems: "baseline", gap: space.s3 },
  state: { marginInlineStart: "auto" },
  hint: { margin: 0, color: color.textSubtle },
  error: { display: "flex", gap: space.s2, alignItems: "center", color: color.danger },
  aside: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 2fr) minmax(0, 3fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    columnGap: space.s7,
    rowGap: space.s3,
    alignItems: "start",
  },
  side: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, paddingBlockStart: space.s2 },
  control: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: space.snug, minWidth: 0 },
});

export type FieldProps = {
  /** the name above the control (compact, medium, in the text colour) */
  label?: string;
  /** the id of the control the label names; without it the label is for the eye only and the control names itself
   * (a Segmented, a radio group with its own label) */
  htmlFor?: string;
  /** at the right of the label: the save state (SaveState) */
  state?: ReactNode;
  /** under the control: what is wrong and what to do; give the control aria-describedby={errorId} */
  error?: string;
  errorId?: string;
  /** under the control, after the error: an example, a consequence; the control's aria-describedby={hintId} */
  hint?: ReactNode;
  hintId?: string;
  /** the control, and what sits right under it (a conflict banner) */
  children: ReactNode;
  /** a settings row: the label, its save state and the hint on the left, the control and its error on the right; one
   * column when the pane is narrow */
  aside?: boolean;
};

// ponytail: the frame of a labelled control (SYSTEM.md Text, Anatomy) — label with the save state at its right, the
// control, the error, the hint; Text and Select draw their label through it, and a screen wraps any other control in
// it (a Segmented, a chip field, the model picker) instead of laying out a label of its own
export function Field({ label, htmlFor, state, error, errorId, hint, hintId, children, aside = false }: FieldProps) {
  const name = (label || state) && (
    <div {...stylex.props(type.label, styles.label)}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span aria-hidden="true">{label}</span>}
      {state && <span {...stylex.props(styles.state)}>{state}</span>}
    </div>
  );
  const wrong = error && (
    <span id={errorId} {...stylex.props(type.small, styles.error)}>
      <Icon name="alert-circle" size="sm" />
      {error}
    </span>
  );
  if (aside)
    return (
      <div {...stylex.props(styles.aside)}>
        <div {...stylex.props(styles.side)}>
          {name}
          {hint && (
            <span id={hintId} {...stylex.props(type.small, styles.hint)}>
              {hint}
            </span>
          )}
        </div>
        <div {...stylex.props(styles.control)}>
          {children}
          {wrong}
        </div>
      </div>
    );
  return (
    <div {...stylex.props(styles.field)}>
      {(label || state) && (
        <div {...stylex.props(type.label, styles.label)}>
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span aria-hidden="true">{label}</span>}
          {state && <span {...stylex.props(styles.state)}>{state}</span>}
        </div>
      )}
      {children}
      {error && (
        <span id={errorId} {...stylex.props(type.small, styles.error)}>
          <Icon name="alert-circle" size="sm" />
          {error}
        </span>
      )}
      {hint && (
        <span id={hintId} {...stylex.props(type.small, styles.hint)}>
          {hint}
        </span>
      )}
    </div>
  );
}
