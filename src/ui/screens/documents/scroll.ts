// ponytail: how far `box` must scroll to show `el` — into view, or centred for the line a link points at
export function into(box: HTMLElement, el: HTMLElement, center = false): number {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (center) return r.top - b.top - Math.max(0, (b.height - r.height) / 2);
  if (r.top < b.top) return r.top - b.top;
  return r.bottom > b.bottom ? r.bottom - b.bottom : 0;
}
