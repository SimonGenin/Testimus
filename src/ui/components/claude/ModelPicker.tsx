import { useEffect, useState } from "react";
import type { Effort } from "../../../core/types.ts";

export const MODELS = ["fable", "opus", "sonnet", "haiku"];
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const VALID = /^[A-Za-z0-9.\-[\]:]+$/;

// ponytail: a model the list does not know (a full id, a new alias) is typed in; it is handed over on blur or
// Enter only, so a half-typed name is never saved nor sent
export function ModelPicker({
  id,
  value,
  className,
  onChange,
}: {
  id?: string;
  value: string;
  className: string;
  onChange: (model: string) => void;
}) {
  const [custom, setCustom] = useState(!MODELS.includes(value));
  const [text, setText] = useState(MODELS.includes(value) ? "" : value);
  useEffect(() => {
    if (MODELS.includes(value)) {
      setCustom(false);
      return;
    }
    setCustom(true);
    setText(value);
  }, [value]);
  const commit = () => {
    const t = text.trim();
    if (t && VALID.test(t) && t !== value) onChange(t);
  };
  return (
    <>
      <select
        id={id}
        className={className}
        aria-label={id ? undefined : "Model"}
        value={custom ? "custom" : value}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setCustom(true);
            setText("");
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {cap(m)}
          </option>
        ))}
        <option value="custom">custom…</option>
      </select>
      {custom && (
        <input
          className="field model-custom mono"
          aria-label="Custom model"
          placeholder="Model id or alias"
          spellCheck={false}
          aria-invalid={!!text.trim() && !VALID.test(text.trim())}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
    </>
  );
}
