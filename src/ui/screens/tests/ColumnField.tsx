import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { type FieldAutosave, Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import type { Column } from "../../lib/columns.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

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
});

// ponytail: a project column is plain text in Xray — it holds no screenshot, so it is no field of blocks
export function ColumnField({
  column,
  value,
  stepNumber,
  readOnly,
  saveState,
  onChange,
}: {
  column: Column;
  value: string;
  stepNumber: number;
  readOnly?: boolean;
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
  return (
    <Text
      multiline={column.kind !== "line"}
      appearance="inline"
      ariaLabel={label}
      value={value}
      placeholder="Empty — type here"
      readOnly={readOnly}
      autosave={saveState}
      onChange={onChange}
    />
  );
}
