import { type ReactNode, useState } from "react";
import { cx } from "../../lib/format.ts";
import { Chip } from "./Chip.tsx";

export function ChipInput({
  label,
  placeholder,
  values,
  mono,
  render,
  onChange,
  className,
  autoFocus,
  slot,
  action,
  removeLabel,
}: {
  label: string;
  placeholder?: string;
  values: string[];
  mono?: boolean;
  render?: (value: string) => ReactNode;
  onChange?: (values: string[]) => void;
  className?: string;
  autoFocus?: boolean;
  slot?: ReactNode;
  action?: ReactNode;
  removeLabel?: (value: string) => string;
}) {
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const add = raw
      .split(/[,;\n]+/)
      .map((v) => v.trim())
      .filter((v) => v && !values.includes(v));
    if (add.length) onChange?.([...values, ...new Set(add)]);
    setText("");
  };
  return (
    <div className={cx("chipinput", className)}>
      {values.map((v) => (
        <Chip
          key={v}
          className={mono ? "chip-mono" : undefined}
          onRemove={onChange && (() => onChange(values.filter((x) => x !== v)))}
          removeLabel={removeLabel ? removeLabel(v) : `Remove ${v}`}
        >
          {render ? render(v) : v}
        </Chip>
      ))}
      {slot}
      {onChange && slot === undefined && (
        <input
          className="chipinput-field"
          aria-label={label}
          placeholder={placeholder}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => (/[,;]$/.test(e.target.value) ? commit(e.target.value) : setText(e.target.value))}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
      )}
      {action}
    </div>
  );
}
