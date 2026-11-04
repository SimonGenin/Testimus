import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Source } from "../../../core/types.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { SourceChip } from "../ui/SourceChip.tsx";

const blink = stylex.keyframes({ "0%, 49%": { opacity: 1 }, "50%, 100%": { opacity: 0 } });

const styles = stylex.create({
  answer: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    color: color.text,
    overflowWrap: "anywhere",
  },
  para: { margin: 0, whiteSpace: "pre-wrap" },
  caret: {
    display: "inline-block",
    width: space.s1,
    height: lineHeight.small,
    marginInlineStart: space.s1,
    verticalAlign: "text-bottom",
    backgroundColor: color.claude,
    animationName: blink,
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

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

// ponytail: Claude's words as React elements, never HTML: each docId#anchor "quote" becomes a source chip in the line
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
    <div {...stylex.props(styles.answer)}>
      {paras.map((p, i) => {
        const parts: ReactNode[] = parseAnswer(p).map((x, k) =>
          typeof x === "string" ? (
            x
          ) : (
            <SourceChip
              key={k}
              reference={sourceLabel(x)}
              quote={x.quote}
              compact
              figure={x.anchor.startsWith("fig:")}
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
