import type { ReactNode } from "react";
import { cx } from "../../lib/format.ts";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; count?: ReactNode; title?: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cx("segs", className)} aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx("seg", value === o.value && "seg-on")}
          aria-pressed={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </fieldset>
  );
}
