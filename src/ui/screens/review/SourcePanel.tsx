import * as stylex from "@stylexjs/stylex";
import type { Finding, Passage, Source } from "../../../core/types.ts";
import { DocBadges, PassageText } from "../../components/sources/PassageView.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Pane } from "../../components/ui/Pane.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { goneText } from "../../lib/docGone.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

export { notAtAnchor } from "./sources.ts";

const styles = stylex.create({
  panel: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    backgroundColor: color.surface,
  },
  foot: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: space.s3 },
  body: {
    boxSizing: "border-box",
    paddingBlock: space.s5,
    paddingInline: space.s6,
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
  },
  doc: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.s3,
    rowGap: space.s2,
    color: color.textMuted,
  },
  code: { color: color.text },
  ref: { color: color.textLink },
  docTitle: { margin: 0 },
  passage: { display: "flex", flexDirection: "column", gap: space.s3 },
  quote: { margin: 0, color: color.textMuted },
  grow: { flex: 1 },
  count: { color: color.textMuted, whiteSpace: "nowrap" },
});

export type SourcePanelProps = {
  source: Source;
  label: string;
  misplaced?: Finding;
  onClose: () => void;
};

export type SourceFootProps = {
  source: Source;
  index: number;
  total: number;
  onOpenDoc: (docId: string, anchor: string, quote: string) => void;
  /** the previous or next source of the test */
  onStep?: (by: 1 | -1) => void;
};

// ponytail: the panel and its foot read the same passage (one read, the data layer's cache)
function usePassage(source: Source) {
  const ref = `${source.docId}#${source.anchor}`;
  const r = useRead("rag.passage", source.quote.trim() ? { ref, around: source.quote } : { ref });
  const passage = r.data as (Passage & { quoteFound?: boolean }) | undefined;
  const gone = r.isError && r.error.code === "doc-gone";
  return { ref, r, passage, gone };
}

// ponytail: the source tab's foot — the passage opened in its document, and the walk through the test's sources
export function SourceFoot(p: SourceFootProps) {
  const { source } = p;
  const { gone } = usePassage(source);
  return (
    <div {...stylex.props(styles.foot)}>
      {!gone && (
        <Button
          size="sm"
          icon="external"
          label="Open in document"
          onClick={() => p.onOpenDoc(source.docId, source.anchor, source.quote)}
        />
      )}
      <span {...stylex.props(styles.grow)} />
      {p.total > 0 && (
        <>
          {p.onStep && (
            <Button
              size="sm"
              variant="quiet"
              iconOnly
              icon="chevron-left"
              label="Previous source"
              disabled={p.index <= 0}
              onClick={() => p.onStep?.(-1)}
            />
          )}
          <span
            {...stylex.props(type.small, styles.count)}
          >{`${p.index + 1} of ${p.total} source${p.total > 1 ? "s" : ""}`}</span>
          {p.onStep && (
            <Button
              size="sm"
              variant="quiet"
              iconOnly
              icon="chevron-right"
              label="Next source"
              disabled={p.index >= p.total - 1}
              onClick={() => p.onStep?.(1)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ponytail: the passage a source names, its quote marked when it is really there — the reviewer's evidence
export function SourcePanel(p: SourcePanelProps) {
  const { source } = p;
  const quote = source.quote;
  const { ref, r, passage, gone } = usePassage(source);
  const quoted = quote && <p {...stylex.props(type.reading, styles.quote)}>« {quote} »</p>;
  return (
    <div {...stylex.props(styles.panel)}>
      <Pane
        as="aside"
        label="Source passage"
        title={p.label}
        fill
        actions={
          <Button size="sm" variant="quiet" iconOnly icon="close" label="Close the source panel" onClick={p.onClose} />
        }
      >
        <div aria-busy={!passage && !r.isError} {...stylex.props(styles.body)}>
          <div {...stylex.props(type.small, styles.doc)}>
            <span {...stylex.props(type.code, styles.code)}>{passage ? passage.doc.code : source.docId}</span>
            {passage && <span>v{passage.doc.version}</span>}
            {passage && <h3 {...stylex.props(type.small, type.regular, styles.docTitle)}>{passage.doc.title}</h3>}
            {passage && <DocBadges status={passage.doc.status} />}
          </div>
          {p.misplaced && (
            <Banner tone="warning" title="The quote is not at this anchor">
              {p.misplaced.message} Not highlighted: the passage below does not hold the quote.
            </Banner>
          )}
          <span {...stylex.props(type.code, styles.ref)}>{ref}</span>
          {gone ? (
            <>
              <Banner tone="neutral" icon="x-circle" title="Document deleted">
                {goneText(source.docId)}
              </Banner>
              {quoted}
            </>
          ) : r.isError ? (
            <>
              <Banner tone="neutral" title="This passage could not be shown.">
                {r.error.message}
              </Banner>
              {quoted}
            </>
          ) : !passage ? (
            <>
              <Skeleton lines={6} />
              <Loading read="rag.passage" />
            </>
          ) : (
            <div {...stylex.props(styles.passage)}>
              {quote.trim() && passage.quoteFound === false && !p.misplaced && (
                <Banner tone="neutral" compact>
                  Not highlighted: the quote is not in this section’s own text (it may sit in a sub-section) — use Open
                  in document to find it.
                </Banner>
              )}
              <PassageText passage={passage} quote={p.misplaced || passage.quoteFound === false ? "" : quote} />
            </div>
          )}
        </div>
      </Pane>
    </div>
  );
}
