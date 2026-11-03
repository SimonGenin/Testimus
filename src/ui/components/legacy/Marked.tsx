import type { SearchMark } from "../../../core/types.ts";

export function Marked({ text, marks }: { text: string; marks: SearchMark[] }) {
  if (!marks.length) return <>{text}</>;
  const parts = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > text.length) continue;
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={a} className="hl">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
