import { GrowArea } from "../../components/legacy/index.ts";
import type { Column } from "../../lib/columns.ts";

// ponytail: a project column is plain text in Xray — it holds no screenshot, so it is no field of blocks
export function ColumnField({
  column,
  value,
  stepNumber,
  readOnly,
  onChange,
}: {
  column: Column;
  value: string;
  stepNumber: number;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const label = `${column.name} of step ${stepNumber}`;
  if (column.kind === "readonly")
    return (
      <div className="colfield is-readonly" title="Xray holds something other than text here — shown, never edited">
        <span>{value || <span className="muted">empty</span>}</span>
        <span className="colfield-note">read-only</span>
      </div>
    );
  return column.kind === "line" ? (
    <input
      className="edit colfield-line"
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <GrowArea
      className="edit"
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
