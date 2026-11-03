import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../../lib/format.ts";

export function Modal({
  label,
  title,
  subtitle,
  width,
  className,
  children,
  foot,
  onClose,
}: {
  label: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  className?: string;
  children: ReactNode;
  foot?: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // ponytail: focus moves into the dialog so Enter cannot re-trigger the button that opened it
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        tabIndex={-1}
        className={cx("dialog", className)}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {(title || subtitle) && (
          <div className="dialog-head">
            {title && <h2 className="h dialog-title">{title}</h2>}
            {subtitle && <div className="muted">{subtitle}</div>}
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {foot && <div className="dialog-foot">{foot}</div>}
      </div>
    </div>
  );
}
