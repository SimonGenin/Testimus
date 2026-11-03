import { type CSSProperties, useRef, useState } from "react";
import { type Action, originLine } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { Icon } from "../ui/index.ts";

// ponytail: the popover is placed on the page (fixed), so a list or a card that clips its overflow never cuts it
export function ActionButton({
  action,
  compact,
  className,
  onOpen,
}: {
  action: Action;
  compact?: boolean;
  className?: string;
  onOpen?: (a: Action) => void;
}) {
  const app = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const running = action.state === "running";
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - 320, window.innerWidth - 328));
    const below = r.bottom + 160 < window.innerHeight;
    setAt(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx("cab", compact && "cab-icon", running && "cab-run", className)}
        aria-label={compact ? action.title : undefined}
        aria-describedby={at ? `pop-${action.id}` : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setAt(null)}
        onFocus={show}
        onBlur={() => setAt(null)}
        onClick={(e) => {
          e.stopPropagation();
          setAt(null);
          (onOpen ?? app.openAction)(action);
        }}
      >
        {running ? <span className="spin spin-sm cab-spin" /> : <Icon name="claude" className="cab-logo" />}
        {!compact && <span className="cab-text">{running ? "Claude is on it…" : action.title}</span>}
      </button>
      {at && (
        <span id={`pop-${action.id}`} role="tooltip" className="cab-pop" style={at}>
          <strong>{compact || running ? action.title : "Claude can fix this"}</strong>
          <span>{action.why}</span>
          <span className="mono cab-from">{originLine(action)}</span>
        </span>
      )}
    </>
  );
}
