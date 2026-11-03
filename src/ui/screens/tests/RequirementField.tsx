import { useState } from "react";
import { Button, RequirementChip } from "../../components/ui/index.ts";
import { joinIds, splitIds } from "../../lib/fields.ts";
import { exampleOf, traceOfField, useOpenId } from "../../lib/traces.ts";

export function RequirementField({
  label,
  value,
  stepNumber,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  stepNumber: number;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const ids = splitIds(value);
  const trace = traceOfField(label);
  const openId = useOpenId();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    const add = splitIds(text).filter((v) => !ids.includes(v));
    if (add.length) onChange(joinIds([...ids, ...add]));
    setText("");
    setAdding(false);
  };
  return (
    <div className="reqfield">
      {ids.map((id) => (
        <RequirementChip
          key={id}
          id={id}
          kind={trace ? trace.label.toLowerCase() : undefined}
          onClick={openId && (() => openId(id))}
          onRemove={readOnly ? undefined : () => onChange(joinIds(ids.filter((x) => x !== id)))}
        />
      ))}
      {!readOnly &&
        (adding ? (
          <input
            className="field reqfield-input mono"
            aria-label={`Add ${label} to step ${stepNumber}`}
            placeholder={trace ? exampleOf(trace) : undefined}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setText("");
                setAdding(false);
              }
            }}
          />
        ) : (
          <Button
            tone="quiet"
            size="sm"
            icon="plus"
            aria-label={`Add ${label} to step ${stepNumber}`}
            onClick={() => setAdding(true)}
          >
            Add
          </Button>
        ))}
    </div>
  );
}
