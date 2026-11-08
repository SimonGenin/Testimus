import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Source } from "../../../core/types.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { SourceChip } from "../ui/SourceChip.tsx";
import { type } from "../ui/type.ts";

const blink = stylex.keyframes({ "0%, 49%": { opacity: 1 }, "50%, 100%": { opacity: 0 } });

const styles = stylex.create({
  answer: { display: "flex", flexDirection: "column", gap: space.s3, color: color.text, overflowWrap: "anywhere" },
  para: { margin: 0, whiteSpace: "pre-wrap" },
  caret: {
    display: "inline-block",
    width: space.s1,
    height: "1em",
    marginInlineStart: space.s1,
    verticalAlign: "text-bottom",
    backgroundColor: color.claude,
    animationName: blink,
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

const REF =
  /\[?([A-Za-z0-9][A-Za-z0-9_.-]*)#((?:§|fig:|img:|frame:|t:)[^\s"),;\]]*[^\s"),;.\]])\]?(?:\s+"([^"\n]*)"\]?)?/g;

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

const same = (a: Source, b: Source) => a.docId === b.docId && a.anchor === b.anchor && a.quote === b.quote;

// the sources a text cites, each once, in order
export function sourcesOf(text: string): Source[] {
  const out: Source[] = [];
  for (const x of parseAnswer(text)) if (typeof x !== "string" && !out.some((s) => same(s, x))) out.push(x);
  return out;
}

// ponytail: Claude's words as React elements, never HTML: each docId#anchor "quote" becomes a source chip in the line,
// unless the answer lists it under the text (`listed`) — then the words stay words and the chip is in the list
export function AnswerText({
  text,
  running,
  listed = [],
  onOpenSource,
}: {
  text: string;
  running?: boolean;
  listed?: Source[];
  onOpenSource: (s: Source) => void;
}) {
  const observed = useObserved();
  const paras = text.split(/\n{2,}/);
  return (
    <div {...stylex.props(type.body, styles.answer)}>
      {paras.map((p, i) => {
        const bits = parseAnswer(p);
        const parts: ReactNode[] = bits.map((x, k) =>
          typeof x === "string" ? (
            typeof bits[k + 1] === "object" && listed.some((s) => same(s, bits[k + 1] as Source)) ? (
              x.replace(/\s+$/, "")
            ) : (
              x
            )
          ) : listed.some((s) => same(s, x)) ? null : (
            <SourceChip
              key={k}
              reference={sourceLabel(x)}
              quote={x.quote}
              compact
              figure={isPictureAnchor(x.anchor)}
              observed={observed(x.docId)}
              onOpen={() => onOpenSource(x)}
            />
          ),
        );
        return (
          <p key={i} {...stylex.props(styles.para)}>
            {parts}
            {running && i === paras.length - 1 && (
              <span aria-hidden="true" data-testid="caret" {...stylex.props(styles.caret)} />
            )}
          </p>
        );
      })}
    </div>
  );
}
