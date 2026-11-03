import * as stylex from "@stylexjs/stylex";
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
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  meta: { fontFamily: fontFamily.mono, fontSize: fontSize.small },
  quote: {
    margin: 0,
    fontFamily: fontFamily.reading,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.reading,
    fontStyle: "italic",
    color: color.textMuted,
  },
});

// ponytail: a source opened — the passage its anchor points at, the quote marked in it; a passage that cannot be read
// says why, and a source whose document was deleted says that
export function PassageDialog({
  source,
  onClose,
  onOpenDoc,
}: {
  source: Source;
  onClose: () => void;
  onOpenDoc?: (docId: string, anchor: string, quote: string) => void;
}) {
  const read = useRead("rag.passage", { ref: `${source.docId}#${source.anchor}` });
  const p = read.data as unknown as Passage | undefined;
  const docs = useRead("docs.list", {}, { enabled: !!read.error });
  const listed = docs.data as unknown as DocRef[] | undefined;
  const gone = !!read.error && !!listed && !listed.some((d) => d.id === source.docId || d.code === source.docId);
  const quote = source.quote && <p {...stylex.props(styles.quote)}>« {source.quote} »</p>;
  return (
    <Modal
      title={p?.doc.title || sourceLabel(source)}
      icon="quote"
      size="lg"
      subtitle={
        <span {...stylex.props(styles.meta)}>
          {p ? `${p.doc.code} · v${p.doc.version}` : source.docId} · {source.anchor}
        </span>
      }
      onClose={onClose}
      actions={
        onOpenDoc &&
        !gone && (
          <Button
            icon="external"
            label="Open in document"
            onClick={() => onOpenDoc(source.docId, source.anchor, source.quote)}
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
            <p>This passage could not be shown: {message(read.error)}</p>
            {quote}
          </>
        ) : !p ? (
          <div role="status" aria-busy="true" aria-label="Loading the passage">
            <Skeleton kind="title" width="40%" />
            <Skeleton lines={3} />
          </div>
        ) : (
          <>
            <span>
              <DocBadges status={p.doc.status} />
            </span>
            <PassageText passage={p} quote={source.quote} />
          </>
        )}
      </section>
    </Modal>
  );
}
