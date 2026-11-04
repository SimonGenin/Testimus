import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { type FieldAutosave, Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import type { Column } from "../../lib/columns.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { hintMarker } from "./markers.stylex.ts";

const styles = stylex.create({
  ro: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s2,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  empty: { color: color.textSubtle },
  field: { position: "relative", minWidth: 0 },
  hint: {
    position: "absolute",
    top: 0,
    insetInlineStart: space.s3,
    display: "flex",
    alignItems: "center",
    height: size.controlMd,
    color: color.textSubtle,
    pointerEvents: "none",
    opacity: { default: 1, [stylex.when.ancestor(":focus-within", hintMarker)]: 0 },
  },
});

// ponytail: a project column is plain text in Xray — it holds no screenshot, so it is no field of blocks; a one-line
// column wraps where the field is narrow (split layout) but still takes no line break
export function ColumnField({
  column,
  value,
  stepNumber,
  readOnly,
  wrap,
  saveState,
  onChange,
}: {
  column: Column;
  value: string;
  stepNumber: number;
  readOnly?: boolean;
  /** the field is narrow: a one-line column wraps instead of clipping */
  wrap?: boolean;
  saveState?: FieldAutosave;
  onChange: (value: string) => void;
}) {
  const label = `${column.name} of step ${stepNumber}`;
  if (column.kind === "readonly")
    return (
      <div {...stylex.props(type.body, styles.ro)}>
        <span {...stylex.props(!value && styles.empty)}>{value || "empty"}</span>
        <Badge label="read-only" size="sm" tooltip="Xray holds something other than text here — shown, never edited" />
      </div>
    );
  const line = column.kind === "line";
  const wrapsLine = line && !!wrap;
  return (
    <div {...stylex.props(hintMarker, styles.field)}>
      <Text
        multiline={!line || wrapsLine}
        appearance="inline"
        ariaLabel={label}
        value={value}
        readOnly={readOnly}
        autosave={saveState}
        onKeyDown={wrapsLine ? (e) => e.key === "Enter" && e.preventDefault() : undefined}
        onChange={(v) => onChange(wrapsLine ? v.replace(/\r?\n/g, " ") : v)}
      />
      {!value && !readOnly && (
        <span aria-hidden="true" {...stylex.props(type.small, styles.hint)}>
          Empty — type here
        </span>
      )}
    </div>
  );
}
