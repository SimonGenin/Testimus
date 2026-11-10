import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type FlowLinks = {
  /** the width of the links' frame */
  w: number;
  /** where the target's middle is, from the top of the frame */
  to: number;
  /** where each node's row is, by node id, from the top of the frame — kept inside it */
  at: Record<string, number>;
};

// ponytail: where FlowMap's links start and end, measured from the page as drawn — after every draw, when the list
// scrolls, and when a fold opened in a row or the container resized moves the rows without drawing the map again. A row
// scrolled out of sight is kept at the edge it went past, so its link leaves from that corner
export function useFlowLinks() {
  const list = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const frame = useRef<SVGSVGElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<FlowLinks>({ w: 0, to: 0, at: {} });

  const measure = () => {
    const s = frame.current?.getBoundingClientRect();
    const t = target.current?.getBoundingClientRect();
    if (!s || !t || !list.current) return;
    const at: Record<string, number> = {};
    for (const el of list.current.querySelectorAll<HTMLElement>("[data-flow-node]")) {
      const r = el.getBoundingClientRect();
      at[el.dataset.flowNode ?? ""] = Math.round(Math.min(Math.max(r.top + r.height / 2 - s.top, 0), s.height));
    }
    const next = { w: Math.round(s.width), to: Math.round(t.top + t.height / 2 - s.top), at };
    setLinks((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  };
  const latest = useRef(measure);
  latest.current = measure;
  useLayoutEffect(() => latest.current());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !list.current || !inner.current) return;
    const watch = new ResizeObserver(() => latest.current());
    watch.observe(list.current);
    watch.observe(inner.current);
    return () => watch.disconnect();
  }, []);

  return { list, inner, frame, target, links, measure };
}
