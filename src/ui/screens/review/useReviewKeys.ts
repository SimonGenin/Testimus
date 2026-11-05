import { useEffect, useRef } from "react";

export type ReviewKeys = {
  next: () => void;
  previous: () => void;
  validate: () => void;
  toFix: () => void;
  step: (by: 1 | -1) => void;
  editing: boolean;
  off: boolean;
};

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// ponytail: J / K move through the queue, V validates, F opens To fix, the arrows move between steps — never while a
// field, a dialog or a menu has the keys
export function useReviewKeys(keys: ReviewKeys): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = ref.current;
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || typing(e.target) || k.off) return;
      if (document.querySelector('[aria-modal="true"], [role="menu"], [aria-haspopup][aria-expanded="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === "j") k.next();
      else if (key === "k") k.previous();
      else if (k.editing) return;
      else if (key === "v") k.validate();
      else if (key === "f") k.toFix();
      else if (e.key === "ArrowDown") k.step(1);
      else if (e.key === "ArrowUp") k.step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
