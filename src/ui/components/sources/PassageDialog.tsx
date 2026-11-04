import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DocRef, Passage, Source } from "../../../core/types.ts";
import { useRead } from "../../lib/data/query.ts";
import { goneText } from "../../lib/docGone.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { message } from "../../lib/format.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { DocBadges, PassageText } from "./PassageView.tsx";

export { highlight } from "./PassageView.tsx";

const styles = stylex.create({
  plain: { margin: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  sub: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.small },
  quote: {
    margin: 0,
    fontFamily: fontFamily.reading,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.reading,
    color: color.textMuted,
  },
  nav: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    fontSize: fontSize.small,
    color: color.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
});

const same = (a: Source, b: Source) => a.docId === b.docId && a.anchor === b.anchor && a.quote === b.quote;

// what the source was opened from: the test (key or id) and the step it backs, and that step's sources, to go from one
// to the next
export type SourceFrom = { test?: string; step?: number; sources?: Source[] };

// ponytail: a source opened — the passage its anchor points at, the quote marked in it; from a step, « Source of step
// n » and ‹ › through that step's sources; a passage that cannot be read says why, and a source whose document was
// deleted says that
export function PassageDialog({
  source: first,
  from,
  onClose,
  onOpenDoc,
}: {
  source: Source;
  from?: SourceFrom;
  onClose: () => void;
  onOpenDoc?: (docId: string, anchor: string, quote: string, from?: { test: string; step?: number }) => void;
}) {
  const cited = from?.test ? { test: from.test, ...(from.step ? { step: from.step } : {}) } : undefined;
  const all = from?.sources?.some((s) => same(s, first)) ? from.sources : [first];
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      all.findIndex((s) => same(s, first)),
    ),
  );
  const source = all[at] ?? first;
  const read = useRead("rag.passage", { ref: `${source.docId}#${source.anchor}` });
  const p = read.data as unknown as Passage | undefined;
  const docs = useRead("docs.list", {}, { enabled: !!read.error });
  const listed = docs.data as unknown as DocRef[] | undefined;
  const gone = !!read.error && !!listed && !listed.some((d) => d.id === source.docId || d.code === source.docId);
  const quote = source.quote && <p {...stylex.props(styles.quote)}>« {source.quote} »</p>;
  return (
    <Modal
      title={from?.step ? `Source of step ${from.step}` : sourceLabel(source)}
      icon="quote"
      subtitle={
        <span {...stylex.props(styles.sub)}>
          <span {...stylex.props(styles.mono)}>{p?.doc.code ?? source.docId}</span>
          {p ? (
            <>
              <span>
                · {p.doc.title} · v{p.doc.version} ·
              </span>
              <DocBadges status={p.doc.status} />
            </>
          ) : null}
          <span {...stylex.props(styles.mono)}>· {source.anchor}</span>
        </span>
      }
      onClose={onClose}
      footNote={
        all.length > 1 && (
          <span {...stylex.props(styles.nav)}>
            <Button
              size="sm"
              variant="quiet"
              icon="chevron-left"
              iconOnly
              label="Previous source"
              disabled={at === 0}
              onClick={() => setAt(at - 1)}
            />
            {at + 1} of {all.length} sources
            <Button
              size="sm"
              variant="quiet"
              icon="chevron-right"
              iconOnly
              label="Next source"
              disabled={at === all.length - 1}
              onClick={() => setAt(at + 1)}
            />
          </span>
        )
      }
      actions={
        onOpenDoc &&
        !gone && (
          <Button
            icon="external"
            label="Open in document"
            onClick={() =>
              cited
                ? onOpenDoc(source.docId, source.anchor, source.quote, cited)
                : onOpenDoc(source.docId, source.anchor, source.quote)
            }
          />
        )
      }
    >
      <section aria-label={`Source ${sourceLabel(source)}`} {...stylex.props(styles.body)}>
        {gone ? (
          <>
            <Banner tone="danger" title="Document deleted">
              {goneText(source.docId)}
            </Banner>
            {quote}
          </>
        ) : read.error ? (
          <>
            <p {...stylex.props(styles.plain)}>This passage could not be shown: {message(read.error)}</p>
            {quote}
          </>
        ) : !p ? (
          <div role="status" aria-busy="true" aria-label="Loading the passage">
            <Skeleton kind="title" width="40%" />
            <Skeleton lines={3} />
          </div>
        ) : (
          <PassageText passage={p} quote={source.quote} />
        )}
      </section>
    </Modal>
  );
}
