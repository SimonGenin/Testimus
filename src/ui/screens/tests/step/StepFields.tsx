import * as stylex from "@stylexjs/stylex";
import type { ClipboardEvent, ReactNode } from "react";
import { breakpoint, color, fontSize, fontWeight, lineHeight, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  stacked: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  split: {
    display: { default: "grid", [breakpoint.narrow]: "flex" },
    flexDirection: "column",
    gap: { default: space.s4, [breakpoint.narrow]: space.s2 },
    alignItems: "start",
  },
  row: {
    display: "grid",
    gridTemplateColumns: { default: `calc(${space.s11} * 2) minmax(0, 1fr)`, [breakpoint.narrow]: "minmax(0, 1fr)" },
    gap: { default: space.s4, [breakpoint.narrow]: space.s1 },
    alignItems: "start",
    minWidth: 0,
  },
  rowSplit: { gridTemplateColumns: "minmax(0, 1fr)", gap: space.s1 },
  label: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s1,
    paddingTop: `calc(${space.s2} + ${space.s1})`,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
    overflowWrap: "anywhere",
  },
  labelSplit: { paddingTop: 0, paddingInlineStart: space.s3 },
  body: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
});

// the fields of a step, one under the other with their labels on the left, or side by side (Action | Expected)
export function StepFields({ split, tracks, children }: { split: boolean; tracks?: string; children: ReactNode }) {
  return (
    <div
      data-testid="step-fields"
      data-layout={split ? "split" : "stacked"}
      {...stylex.props(split ? styles.split : styles.stacked)}
      style={split && tracks ? { gridTemplateColumns: tracks } : undefined}
    >
      {children}
    </div>
  );
}

export function FieldRow({
  name,
  split,
  note,
  onPaste,
  children,
}: {
  name: string;
  split: boolean;
  /** under the label: « not in Xray », « off in Xray » */
  note?: ReactNode;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div data-field={name} {...stylex.props(styles.row, split && styles.rowSplit)} onPaste={onPaste}>
      <div {...stylex.props(styles.label, split && styles.labelSplit)}>
        <span data-testid="field-label">{name}</span>
        {note}
      </div>
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  );
}
