import { useEffect, useRef } from "react";

export type RunKeys = {
  mark: (ok: boolean) => void;
  step: (by: 1 | -1) => void;
  saveNext: () => void;
};

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// ponytail: O marks the current step OK, N NOK, J / K move to the next / previous step — never while a field, a dialog
// or a menu has the keys; Ctrl+Enter saves the result and opens the next test from anywhere but a dialog
export function useRunKeys(keys: RunKeys): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = ref.current;
      if (e.defaultPrevented || e.altKey) return;
      if (document.querySelector('[aria-modal="true"], [role="menu"], [aria-haspopup][aria-expanded="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        k.saveNext();
        return;
      }
      if (e.ctrlKey || e.metaKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "o") k.mark(true);
      else if (key === "n") k.mark(false);
      else if (key === "j") k.step(1);
      else if (key === "k") k.step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
