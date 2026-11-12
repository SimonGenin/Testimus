import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { isMedia } from "../../lib/media.ts";
import { addMedia } from "../../lib/media-uploads.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { border, color, duration, easing } from "../../styles/tokens.stylex.ts";
import { ConvertDoc } from "./ConvertDoc.tsx";
import { DocFigures } from "./DocFigures.tsx";
import { DocHead, type View } from "./DocHead.tsx";
import { DocLoading } from "./DocLoading.tsx";
import { DocPart, type QuoteFrom } from "./DocPart.tsx";
import { DocReading } from "./DocReading.tsx";
import { DocToc } from "./DocToc.tsx";
import { DocUnreadable } from "./DocUnreadable.tsx";
import { tocFits, useTocPane } from "./layout.ts";
import { MediaImages } from "./MediaImages.tsx";
import { MediaVideo } from "./MediaVideo.tsx";
import { PendingDoc } from "./PendingDoc.tsx";
import { RemoveDoc } from "./RemoveDoc.tsx";
import { useDocSet } from "./useDocSet.ts";

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  doc: { boxSizing: "border-box", flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  row: { flexDirection: "row" },
  opened: { animationName: fadeIn, animationDuration: duration.slow, animationTimingFunction: easing.enter },
  reader: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  body: { flex: 1, minHeight: 0, display: "flex", minWidth: 0 },
  toc: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    minHeight: 0,
    backgroundColor: color.surface,
    borderRightStyle: "solid",
    borderRightWidth: border.width,
    borderRightColor: color.border,
  },
  width: (w: number) => ({ width: w }),
  view: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
});

// ponytail: one document — its head, its contents beside the part being read (or its figures, or the conversion going
// on); the contents fold into a drawer when the document's section is too narrow for both. What the team decides
// about it is the screen's Details tab (DocDetails)
export function DocDetail({
  id,
  anchor,
  quote = "",
  from,
  onClearQuote,
  onAnchor,
  onRemoved,
}: {
  id: string;
  anchor: string;
  quote?: string;
  from?: QuoteFrom;
  onClearQuote?: () => void;
  onAnchor: (anchor: string) => void;
  onRemoved: () => void;
}) {
  const client = useQueryClient();
  const meta = useRead("docs.show", { id, brief: true });
  const listed = useRead("docs.list", {}).data?.find?.((d) => d.id === id);
  const running = useUploads().find((u) => u.docId === id && u.job === "convert" && !settled(u));
  const [chosen, setView] = useState<View | null>(null);
  const [drawer, setDrawer] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const [ask, setAsk] = useState(false);
  const [again, setAgain] = useState(false);
  const [figure, setFigure] = useState<string>();
  const [opened, setOpened] = useState(false);
  const wasRunning = useRef(false);
  const tocPane = useTocPane(width);
  const tocFolded = !tocFits(width, tocPane.value);

  const shown = meta.data;
  const sections = shown?.toc ?? [];
  const converted = !!shown?.doc.converted?.at;
  const reading = !!shown && !running && converted;
  const media = !!shown && isMedia(shown.type);
  const files = shown?.doc.source.files ?? [];
  // ponytail: an images or video document opens on its pictures or its player — on its player when a link names a
  // moment (t:, frame:), on its pictures for an image (img:), on its text for a section
  const view: View =
    chosen ??
    (!media
      ? "text"
      : /^(t|v|frame):/.test(anchor) && files.some((f) => f.kind === "video")
        ? "video"
        : anchor.startsWith("§")
          ? "text"
          : files.some((f) => f.kind === "image")
            ? "images"
            : "video");
  const pictures = useRead("media.show", { doc: id }, { enabled: reading && media });
  const target = anchor || sections.find((t) => t.level > 1)?.anchor || sections[0]?.anchor || "";
  const fig = target.startsWith("fig:") || /^(img|frame|t):/.test(target) ? target : "";
  const holder = useRead("docs.show", { id, anchor: fig, brief: true }, { enabled: reading && !!fig });
  const read = fig ? holder.data?.section || (holder.isFetched ? fig : "") : target;
  const part = useRead("docs.show", read ? { id, anchor: read, whole: true } : { id }, {
    enabled: reading && view === "text" && (!fig || !!read),
    keepPrevious: true,
  });

  const settings = useDocSet(id);
  const loaded = !!meta.data;

  // ponytail: measured before the first paint — the contents drawn for one frame in a narrow section would jump away
  // biome-ignore lint/correctness/useExhaustiveDependencies: the element observed is another once the document lands
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.getBoundingClientRect().width);
    const watch = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, [loaded]);

  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      setOpened(true);
    }
  }, [running]);

  useEffect(() => {
    if (drawer && !tocFolded) setDrawer(false);
  }, [drawer, tocFolded]);

  const label = `${shown?.doc.code ?? id} details`;
  if (meta.isError)
    return (
      <section aria-label={label} {...stylex.props(styles.doc)}>
        <DocUnreadable
          id={id}
          doc={listed}
          error={message(meta.error)}
          onRetry={() => void meta.refetch()}
          onConvertAgain={listed ? () => setAgain(true) : undefined}
          onDelete={listed ? () => setAsk(true) : undefined}
        />
        {again && listed && <ConvertDoc doc={listed} again onClose={() => setAgain(false)} />}
        {ask && listed && <RemoveDoc doc={listed} onClose={() => setAsk(false)} onRemoved={onRemoved} />}
      </section>
    );
  if (!shown)
    return (
      <div ref={box} {...stylex.props(styles.doc)}>
        <DocLoading label={label} read="docs.show" toc={!tocFolded} tocWidth={tocPane.value} />
      </div>
    );

  const d = { ...shown.doc, type: shown.type, observed: shown.observed };
  const current = (!part.isPlaceholderData && part.data?.section) || target;
  const go = (a: string) => {
    setView("text");
    setDrawer(false);
    onAnchor(a);
  };
  const toc = (head: boolean) => <DocToc sections={sections} current={current} head={head} onGo={go} />;

  return (
    <section
      ref={box}
      aria-label={`${d.code} details`}
      data-opened={opened || undefined}
      {...stylex.props(styles.doc, styles.row, opened && styles.opened)}
    >
      <div {...stylex.props(styles.reader)}>
        <DocHead
          doc={d}
          sections={sections.length}
          figures={shown.figures.length}
          running={!!running}
          view={view}
          onView={(v) => {
            setFigure(undefined);
            setView(v);
          }}
          sectionsButton={tocFolded}
          sectionsOpen={drawer}
          onSections={() => setDrawer((o) => !o)}
          onConvertAgain={() => setAgain(true)}
          onDelete={() => setAsk(true)}
          onAddMedia={
            media
              ? (picked) =>
                  void addMedia(
                    id,
                    d.title || d.code,
                    picked,
                    () => void invalidate(client, [["docs.list"], ["docs.show", { id }], ["media.show", { doc: id }]]),
                  )
              : undefined
          }
          onReference={media ? settings.reference : undefined}
        />
        <div {...stylex.props(styles.body)}>
          {reading && !tocFolded && view === "text" && (sections.length > 1 || !media) && (
            <>
              <div {...stylex.props(styles.toc, styles.width(tocPane.value))}>{toc(true)}</div>
              <ResizeHandle label="Resize the sections" {...tocPane} />
            </>
          )}
          {reading && tocFolded && drawer && (
            <Modal title="Contents" drawer="left" flush onClose={() => setDrawer(false)}>
              {toc(false)}
            </Modal>
          )}
          <div {...stylex.props(styles.view)}>
            {running && <DocReading docId={id} upload={running} />}
            {!running && !converted && listed?.pending && <PendingDoc doc={listed} onRemoved={onRemoved} />}
            {!running && !converted && !listed?.pending && <ConvertDoc doc={d} />}
            {reading && view === "images" && (
              <MediaImages docId={id} shown={pictures.data} focus={anchor.startsWith("img:") ? anchor : undefined} />
            )}
            {reading && view === "video" && <MediaVideo docId={id} shown={pictures.data} anchor={anchor} />}
            {reading && view === "figures" && (
              <DocFigures docId={id} figures={shown.figures} focus={figure} onOpen={go} />
            )}
            {reading && view === "text" && (
              <DocPart
                docId={id}
                sections={sections}
                current={current}
                md={part.isError ? message(part.error) : (part.data?.md ?? "")}
                loading={!part.data && !part.isError}
                focus={quote || undefined}
                target={anchor && !quote ? anchor : undefined}
                quote={onClearQuote ? { from, onClear: onClearQuote } : undefined}
                observed={d.observed}
                onGo={go}
                onFigure={(a) => {
                  setFigure(a);
                  setView("figures");
                }}
              />
            )}
          </div>
        </div>
      </div>
      {again && (
        <ConvertDoc
          doc={d}
          again
          described={shown.figures.filter((f) => f.description.trim()).length}
          onClose={() => setAgain(false)}
        />
      )}
      {ask && <RemoveDoc doc={d} onClose={() => setAsk(false)} onRemoved={onRemoved} />}
    </section>
  );
}
