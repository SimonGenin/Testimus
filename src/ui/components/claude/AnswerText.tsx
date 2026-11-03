import type { ReactNode } from "react";
import type { Source } from "../../../core/types.ts";
import { SourceChip } from "../ui/index.ts";

const REF = /\[?([A-Za-z0-9][A-Za-z0-9_.-]*)#((?:§|fig:)[^\s"),;\]]*[^\s"),;.\]])\]?(?:\s+"([^"\n]*)"\]?)?/g;

export function parseAnswer(text: string): Array<string | Source> {
  const out: Array<string | Source> = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ docId: m[1], anchor: m[2], quote: m[3] ?? "" });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AnswerText({
  text,
  running,
  onOpenSource,
}: {
  text: string;
  running?: boolean;
  onOpenSource: (s: Source) => void;
}) {
  const paras = text.split(/\n{2,}/);
  return (
    <div className="answer">
      {paras.map((p, i) => {
        const parts: ReactNode[] = parseAnswer(p).map((x, k) =>
          typeof x === "string" ? x : <SourceChip key={k} source={x} inline onOpen={onOpenSource} />,
        );
        return (
          <p key={i}>
            {parts}
            {running && i === paras.length - 1 && <span className="caret" aria-hidden="true" />}
          </p>
        );
      })}
    </div>
  );
}
