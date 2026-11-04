import * as stylex from "@stylexjs/stylex";
import type { Finding, Passage, Source } from "../../../core/types.ts";
import { DocBadges, PassageText } from "../../components/sources/PassageView.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useRead } from "../../lib/data/query.ts";
import { goneText } from "../../lib/docGone.ts";
import {
  border,
  color,
  container,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { EvidenceBlock } from "./EvidenceBlock.tsx";

export { notAtAnchor } from "./sources.ts";

const styles = stylex.create({
  panel: {
    flex: "0 1 auto",
    width: size.dock,
    minWidth: size.sidebar,
    display: { default: "flex", [container.reviewSource]: "none" },
    flexDirection: "column",
    minHeight: 0,
    backgroundColor: color.surface,
  },
  head: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: space.s5,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
  },
  body: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
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
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  code: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.text },
  ref: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textLink },
  docTitle: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, fontWeight: fontWeight.regular },
  passage: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    fontFamily: fontFamily.reading,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.reading,
  },
  quote: { margin: 0, fontFamily: fontFamily.reading, color: color.textMuted },
  foot: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
  },
  grow: { flex: 1 },
  count: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted, whiteSpace: "nowrap" },
});

export type SourcePanelProps = {
  source: Source;
  label: string;
  index: number;
  total: number;
  testId: string;
  misplaced?: Finding;
  width?: number;
  onClose: () => void;
  onOpenDoc: (docId: string, anchor: string, quote: string) => void;
  onPick: (ref: string) => void;
  /** the previous or next source of the test */
  onStep?: (by: 1 | -1) => void;
};

// ponytail: the passage a source names, its quote marked when it is really there — the reviewer's evidence
export function SourcePanel(p: SourcePanelProps) {
  const { source } = p;
  const ref = `${source.docId}#${source.anchor}`;
  const quote = source.quote;
  const r = useRead("rag.passage", quote.trim() ? { ref, around: quote } : { ref });
  const passage = r.data as (Passage & { quoteFound?: boolean }) | undefined;
  const gone = r.isError && r.error.code === "doc-gone";
  const quoted = quote && <p {...stylex.props(styles.quote)}>« {quote} »</p>;
  return (
    <aside aria-label="Source passage" {...stylex.props(styles.panel)} style={p.width ? { width: p.width } : undefined}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.title)}>{p.label}</span>
        <Button size="sm" variant="quiet" iconOnly icon="close" label="Close the source panel" onClick={p.onClose} />
      </div>
      <div aria-busy={!passage && !r.isError} {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.doc)}>
          <span {...stylex.props(styles.code)}>{passage ? passage.doc.code : source.docId}</span>
          {passage && <span>v{passage.doc.version}</span>}
          {passage && <h3 {...stylex.props(styles.docTitle)}>{passage.doc.title}</h3>}
          {passage && <DocBadges status={passage.doc.status} />}
        </div>
        {p.misplaced && (
          <Banner tone="warning" title="The quote is not at this anchor">
            {p.misplaced.message} Not highlighted: the passage below does not hold the quote.
          </Banner>
        )}
        <span {...stylex.props(styles.ref)}>{ref}</span>
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
          <Skeleton lines={6} />
        ) : (
          <div {...stylex.props(styles.passage)}>
            {quote.trim() && passage.quoteFound === false && !p.misplaced && (
              <Banner tone="neutral" compact>
                Not highlighted: the quote is not in this section’s own text (it may sit in a sub-section) — use Open in
                document to find it.
              </Banner>
            )}
            <PassageText passage={passage} quote={p.misplaced || passage.quoteFound === false ? "" : quote} />
          </div>
        )}
        {p.testId && <EvidenceBlock testId={p.testId} selected={ref} onPick={p.onPick} />}
      </div>
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
              {...stylex.props(styles.count)}
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
    </aside>
  );
}
