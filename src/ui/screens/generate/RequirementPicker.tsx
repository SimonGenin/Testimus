import { useId, useMemo, useState } from "react";
import { RequirementChip } from "../../components/ui/index.ts";
import { cx } from "../../lib/format.ts";
import type { Requirement } from "../../lib/requirements.ts";

export function RequirementPicker({
  inputId,
  kind,
  known,
  values,
  onChange,
}: {
  inputId: string;
  kind: string;
  known: Requirement[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const list = useId();
  const q = text.trim().toLowerCase();
  const hits = useMemo(
    () =>
      q
        ? known
            .filter(
              (r) => !values.includes(r.id) && (r.id.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)),
            )
            .slice(0, 8)
        : [],
    [known, values, q],
  );
  const add = (ids: string[]) => {
    const next = ids.map((v) => v.trim()).filter((v) => v && !values.includes(v));
    if (next.length) onChange([...values, ...new Set(next)]);
    setText("");
    setAt(0);
  };
  return (
    <div className="reqpick">
      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <RequirementChip
              key={v}
              id={v}
              kind={kind}
              error={known.length > 0 && !known.some((r) => r.id === v)}
              onRemove={() => onChange(values.filter((x) => x !== v))}
            />
          ))}
        </div>
      )}
      <input
        id={inputId}
        className="field"
        placeholder="Add by id or by word"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && hits.length) {
            e.preventDefault();
            setAt((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp" && hits.length) {
            e.preventDefault();
            setAt((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (hits[at] && !/[\s,;]/.test(text.trim())) add([hits[at].id]);
            else add(text.split(/[\s,;]+/));
          } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
        }}
      />
      {hits.length > 0 && (
        <div id={list} className="reqpick-list" role="listbox" aria-label={`Matching ${kind} ids`}>
          {hits.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === at}
              className={cx("reqpick-opt", i === at && "is-on")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add([r.id])}
            >
              <span className="mono">{r.id}</span>
              {r.text && <span className="muted reqpick-text">{r.text}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
