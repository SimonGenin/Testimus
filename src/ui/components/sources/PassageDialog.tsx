import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DocRef, Passage, Source } from "../../../core/types.ts";
import { useRead } from "../../lib/data/query.ts";
import { goneText } from "../../lib/docGone.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { message } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Pane } from "../ui/Pane.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { type } from "../ui/type.ts";
import { DocBadges, PassageText } from "./PassageView.tsx";
import { isVideoSource, VideoSource } from "./VideoSource.tsx";

const styles = stylex.create({
  tab: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", backgroundColor: color.surface },
  tabBody: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingBlock: space.s5,
    paddingInline: space.s6,
  },
  plain: { margin: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  sub: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  quote: { margin: 0, color: color.textMuted },
  nav: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
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
// deleted says that. In a screen's Source tab (frame "tab"), or a dialog where a screen has no sections
export function PassageDialog({
  source: first,
  from,
  frame = "modal",
  onClose,
  onOpenDoc,
}: {
  source: Source;
  from?: SourceFrom;
  frame?: "modal" | "tab";
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
  const timed = isVideoSource(source.anchor);
  const read = useRead("rag.passage", { ref: `${source.docId}#${source.anchor}` }, { enabled: !timed });
  const p = read.data as unknown as Passage | undefined;
  const docs = useRead("docs.list", {}, { enabled: !!read.error });
  const listed = docs.data as unknown as DocRef[] | undefined;
  const gone = !!read.error && !!listed && !listed.some((d) => d.id === source.docId || d.code === source.docId);
  const quote = source.quote && <p {...stylex.props(type.reading, styles.quote)}>« {source.quote} »</p>;
  const title = from?.step ? `Source of step ${from.step}` : sourceLabel(source);
  const subtitle = (
    <span {...stylex.props(styles.sub)}>
      <span {...stylex.props(type.small, type.mono)}>{p?.doc.code ?? source.docId}</span>
      {p ? (
        <>
          <span>
            · {p.doc.title} · v{p.doc.version} ·
          </span>
          <DocBadges status={p.doc.status} />
        </>
      ) : (
        <span {...stylex.props(type.small, type.mono)}>· {source.anchor}</span>
      )}
    </span>
  );
  const nav = all.length > 1 && (
    <span {...stylex.props(type.small, styles.nav)}>
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
  );
  const openDoc = (size?: "sm") =>
    onOpenDoc &&
    !gone && (
      <Button
        size={size}
        icon="external"
        label="Open in document"
        onClick={() =>
          cited
            ? onOpenDoc(source.docId, source.anchor, source.quote, cited)
            : onOpenDoc(source.docId, source.anchor, source.quote)
        }
      />
    );
  const body = (
    <section aria-label={`Source ${sourceLabel(source)}`} {...stylex.props(styles.body)}>
      {timed ? (
        <VideoSource source={source} from={from} size={frame === "tab" ? "sm" : "md"} />
      ) : gone ? (
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
          <Loading read="rag.passage" />
        </div>
      ) : (
        <PassageText passage={p} quote={source.quote} />
      )}
    </section>
  );
  if (frame === "tab")
    return (
      <div {...stylex.props(styles.tab)}>
        <Pane
          as="aside"
          title={title}
          fill
          actions={
            <>
              {openDoc("sm")}
              <Button size="sm" variant="quiet" iconOnly icon="close" label="Close the source" onClick={onClose} />
            </>
          }
          footer={nav || undefined}
        >
          <div {...stylex.props(styles.tabBody)}>
            {subtitle}
            {body}
          </div>
        </Pane>
      </div>
    );
  return (
    <Modal title={title} icon="quote" subtitle={subtitle} onClose={onClose} footNote={nav} actions={openDoc()}>
      {body}
    </Modal>
  );
}
