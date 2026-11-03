import type { ReactNode } from "react";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

export function Chip({
  icon,
  on,
  error,
  small,
  className,
  title,
  onClick,
  onRemove,
  removeLabel,
  children,
}: {
  icon?: IconName;
  on?: boolean;
  error?: boolean;
  small?: boolean;
  className?: string;
  title?: string;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}) {
  const cls = cx("chip", on && "chip-on", error && "chip-err", small && "chip-sm", className);
  const body = (
    <>
      {icon && <Icon name={icon} />}
      {children}
    </>
  );
  return (
    <span className={cx("chipwrap", onRemove && "has-x")}>
      {onClick ? (
        <button type="button" className={cls} title={title} aria-pressed={on || undefined} onClick={onClick}>
          {body}
        </button>
      ) : (
        <span className={cls} title={title}>
          {body}
        </span>
      )}
      {onRemove && (
        <button type="button" className="chip-x" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
