import { useEffect, useRef } from "react";

// ponytail: Ctrl+V of a picture anywhere on the test being run attaches it to the step being played — a field keeps
// pasting its text; a dialog or a menu open keeps the paste to itself
export function useRunPaste(onFiles: (files: File[]) => void): void {
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      ref.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
}
