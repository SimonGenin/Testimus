import type { StepColumn } from "../../../core/types.ts";
import { Button } from "../../components/ui/index.ts";
import { cx } from "../../lib/format.ts";

export function columnTag(c: StepColumn): { label: string; tone: string } {
  if (c.status === "gone") return { label: "No longer in Xray", tone: "warn" };
  if (c.origin === "local") return { label: "Local only", tone: "warn" };
  if (c.status === "new") return { label: "New in Xray", tone: "warn" };
  return { label: c.builtin ? "Xray · standard" : "Xray", tone: "info" };
}

export function ColumnsView({ columns, onEdit }: { columns: StepColumn[]; onEdit: () => void }) {
  const fresh = columns.filter((c) => c.status === "new").length;
  return (
    <div className="colview">
      <div className="colview-head">
        <span className="h gen-label">Smart columns</span>
        <span className="spacer" />
        <Button size="sm" tone={fresh ? "primary" : "quiet"} icon="edit" onClick={onEdit}>
          {fresh ? "Define the columns" : "Edit in Settings"}
        </Button>
      </div>
      {fresh > 0 && (
        <p className="colview-warn">
          {fresh === 1 ? "A column" : `${fresh} columns`} came from Xray without a description — Claude leaves{" "}
          {fresh === 1 ? "it" : "them"} empty until described.
        </p>
      )}
      <ol className="colview-list" aria-label="Smart columns">
        {columns.map((c) => {
          const tag = columnTag(c);
          return (
            <li key={c.name} className={cx("colview-item", !c.description && "is-empty")}>
              <span className="colview-name">
                <strong>{c.name}</strong>
                <span className={cx("tagpill", `tagpill-${tag.tone}`)}>{tag.label}</span>
              </span>
              {c.description ? (
                <span className="colview-desc">{c.description}</span>
              ) : (
                <span className="muted colview-desc">No description — Claude leaves it empty.</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
