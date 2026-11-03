import { useEffect, useRef, useState } from "react";
import type { ColumnMode, StepColumn } from "../../../core/types.ts";
import { Icon, IconButton } from "../../components/ui/index.ts";
import { MODES } from "../../lib/columns.ts";
import { cx } from "../../lib/format.ts";
import { columnTag } from "../generate/ColumnsView.tsx";

export function ColumnRow({
  column,
  mode,
  hidden,
  disabled,
  first,
  last,
  dragging,
  onDescribe,
  onMode,
  onHidden,
  onMove,
  onRemove,
  drag,
}: {
  column: StepColumn;
  mode: ColumnMode;
  hidden: boolean;
  disabled: boolean;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onDescribe: (text: string) => void;
  onMode: (m: ColumnMode) => void;
  onHidden: (h: boolean) => void;
  onMove: (by: number) => void;
  onRemove?: () => void;
  drag: Pick<React.HTMLAttributes<HTMLLIElement>, "draggable" | "onDragStart" | "onDragOver" | "onDrop" | "onDragEnd">;
}) {
  const c = column;
  const [text, setText] = useState(c.description);
  useEffect(() => setText(c.description), [c.description]);
  // ponytail: leaving Settings unmounts the row without a blur — a typed description is saved from the cleanup,
  // once: a blur just before has already sent it
  const sent = useRef(c.description);
  const describe = () => {
    if (text.trim() === c.description || text === sent.current) return;
    sent.current = text;
    onDescribe(text);
  };
  const onUnmount = useRef(describe);
  onUnmount.current = describe;
  useEffect(() => () => onUnmount.current(), []);
  const tag = columnTag(c);
  const foldable = c.name !== "Action" && c.name !== "Expected Result";
  const id = `col-${c.name.replace(/\W+/g, "-")}`;
  return (
    <li className={cx("colrow", dragging && "is-dragging", c.status !== "ok" && "is-attention")} {...drag}>
      <div className="colrow-head">
        <span className="grip" aria-hidden="true">
          <Icon name="grip" />
        </span>
        <span className="colrow-name">{c.name}</span>
        <span className={cx("tagpill", `tagpill-${tag.tone}`)}>{tag.label}</span>
        <span className="spacer" />
        <select
          className="field frow-mode"
          aria-label={`${c.name} folding`}
          value={mode}
          disabled={!foldable || disabled}
          title={foldable ? "How it shows on a step" : `${c.name} is always open`}
          onChange={(e) => onMode(e.target.value as ColumnMode)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.title}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="frow-check" title="Hidden in this project unless a step holds text in it">
          <input
            type="checkbox"
            checked={hidden}
            disabled={disabled}
            aria-label={`${c.name} hidden`}
            onChange={(e) => onHidden(e.target.checked)}
          />
          Hidden
        </label>
        <span className="frow-move">
          <IconButton icon="up" label={`Move ${c.name} up`} disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon="down" label={`Move ${c.name} down`} disabled={last} onClick={() => onMove(1)} />
          {onRemove && <IconButton icon="trash" label={`Remove the column ${c.name}`} onClick={onRemove} />}
        </span>
      </div>
      <label htmlFor={id} className="sr">
        What Claude writes in {c.name}
      </label>
      <textarea
        id={id}
        className="field colrow-desc"
        rows={2}
        placeholder="Empty: Claude leaves this column empty"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={describe}
      />
      {c.status === "new" && (
        <p className="colrow-note">New in Xray: describe it, or leave it empty and Claude never fills it.</p>
      )}
      {c.status === "gone" && (
        <p className="colrow-note">
          No longer in Xray: what the tests hold in it stays in test.md, as a local column. Remove it once you no longer
          need it.
        </p>
      )}
    </li>
  );
}
