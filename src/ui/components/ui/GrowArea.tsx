import { type ComponentProps, useLayoutEffect, useRef } from "react";

// ponytail: the prototype's auto-grow — height:auto then scrollHeight+2, no measuring library. Flex is
// switched off while measuring, or a stretched box would report its row height and never shrink back;
// the width is pinned meanwhile, or a box sized by a flex row would measure at its intrinsic width
const grow = (t: HTMLTextAreaElement | null) => {
  if (!t) return;
  const width = t.getBoundingClientRect().width;
  if (width) t.style.width = `${width}px`;
  t.style.flex = "none";
  t.style.minHeight = "0";
  t.style.minHeight = `${t.scrollHeight + 2}px`;
  t.style.flex = "";
  t.style.width = "";
};

export function GrowArea({ value, ...rest }: ComponentProps<"textarea"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (value !== undefined) grow(ref.current);
  }, [value]);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || typeof ResizeObserver === "undefined") return;
    let w = t.clientWidth;
    const ro = new ResizeObserver(() => {
      if (t.clientWidth === w) return;
      w = t.clientWidth;
      grow(t);
    });
    ro.observe(t);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const regrow = () => grow(t);
    fonts?.addEventListener?.("loadingdone", regrow);
    void fonts?.ready?.then(regrow);
    return () => {
      ro.disconnect();
      fonts?.removeEventListener?.("loadingdone", regrow);
    };
  }, []);
  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}
