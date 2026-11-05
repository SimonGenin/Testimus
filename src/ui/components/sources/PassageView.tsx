import type { Passage as Part } from "../../../core/types.ts";
import { Badge, DOC_STATUS } from "../ui/Badge.tsx";
import { Passage } from "../ui/Passage.tsx";
import { DocText } from "./DocText.tsx";

// the Documents route of a source; its quote (empty when the source has none), and `from`: the test (and step) that
// cites it and the screen it was read on (Review, else Tests), for « Back to the test »
export const docLink = (
  docId: string,
  anchor: string,
  quote = "",
  from?: { test: string; step?: number; screen?: "review" },
) =>
  `${docId}#${anchor}${quote.trim() || from ? ` "${quote.trim()}"` : ""}${from ? ` from ${from.screen ? `${from.screen} ` : ""}${from.test}${from.step ? ` step ${from.step}` : ""}` : ""}`;

export const sectionNumber = (anchor: string) => (anchor.startsWith("§") ? anchor.slice(1) : "");

export function DocBadges({ status }: { status: string }) {
  const s = DOC_STATUS[status as keyof typeof DOC_STATUS];
  return s ? <Badge {...s} /> : <Badge tone="neutral" label={status} />;
}

// ponytail: a figure read by its anchor (fig:40) is drawn as the reader draws it — its picture, or the table of the text
// it captions, with its caption — then what it shows
function figureMd(passage: Part): string {
  const f = passage.figures[0];
  if (!f || (!f.file && !f.table)) return passage.text;
  const n = f.anchor.replace(/^fig:/, "");
  const shown = f.file
    ? `![${f.caption.replace(/[[\]\\]/g, "\\$&")}](${f.file}) <!-- fig ${n} -->`
    : `${f.table}\n\n${f.caption}`;
  return [shown, f.description].filter(Boolean).join("\n\n");
}

// ponytail: a passage as the document says it — its title with its number, then its text drawn the way the documents
// reader draws it (DocText: tables, pictures where they stand, Word's bold and italic, the quote marked); the space
// before the title keeps the heading's name « § 5.6.6 Title »
export function PassageText({ passage, quote }: { passage: Part; quote: string }) {
  const num = sectionNumber(passage.anchor);
  const title = num && passage.title.startsWith(`${num} `) ? passage.title.slice(num.length + 1) : passage.title;
  const md = passage.anchor.startsWith("fig:") ? figureMd(passage) : passage.text;
  return (
    <Passage level={4} heading={passage.title ? title : undefined} anchor={num ? `§ ${num}` : undefined}>
      <DocText docId={passage.docId} md={md} focus={quote} gutter={false} />
    </Passage>
  );
}
