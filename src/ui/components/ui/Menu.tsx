import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type MenuItem =
  | { kind: "sep"; key: string }
  | {
      kind?: "item";
      key: string;
      label: ReactNode;
      icon?: IconName;
      hint?: string;
      title?: string;
      on?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

export function Menu({
  label,
  trigger,
  items,
  align = "left",
  up,
  className,
}: {
  label: string;
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  up?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <div className={cx("menu", className)} ref={box}>
      {trigger({ open, toggle: () => setOpen((v) => !v), id })}
      {open && (
        <div
          id={id}
          className={cx("menu-list", align === "right" && "is-right", up && "is-up")}
          role="menu"
          aria-label={label}
        >
          {items.map((i) =>
            i.kind === "sep" ? (
              <hr key={i.key} className="menu-sep" />
            ) : (
              <button
                key={i.key}
                type="button"
                role="menuitem"
                aria-current={i.on || undefined}
                className={cx("menu-item", i.on && "is-on")}
                title={i.title}
                disabled={i.disabled}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
              >
                {i.icon ? <Icon name={i.icon} /> : <span className="menu-gap" />}
                <span className="menu-label">{i.label}</span>
                {i.hint && <span className="menu-hint">{i.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
