import type { ReactNode } from "react";
import { cx } from "../../lib/format.ts";

export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("tabs", className)} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={cx("tab", value === o.value && "tab-on")}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
