import type { ReactNode } from "react";
import { cx } from "../../lib/format.ts";

export function Field({
  label,
  htmlFor,
  hint,
  action,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("formfield", className)}>
      <div className="formfield-head">
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && <span className="formfield-hint">{hint}</span>}
    </div>
  );
}
