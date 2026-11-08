import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { isMedia } from "../../lib/media.ts";
import { addMedia } from "../../lib/media-uploads.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { border, color, duration, easing, space } from "../../styles/tokens.stylex.ts";
import { ConvertDoc } from "./ConvertDoc.tsx";
import { DocFigures } from "./DocFigures.tsx";
import { DocHead, type View } from "./DocHead.tsx";
import { DocLoading } from "./DocLoading.tsx";
import { DocPart, type QuoteFrom } from "./DocPart.tsx";
import { DocReading } from "./DocReading.tsx";
import { DocSide } from "./DocSide.tsx";
import { DocToc } from "./DocToc.tsx";
import { DocUnreadable } from "./DocUnreadable.tsx";
import { COLS, type Fold, type Pane } from "./layout.ts";
import { MediaImages } from "./MediaImages.tsx";
import { MediaVideo } from "./MediaVideo.tsx";
import { RemoveDoc } from "./RemoveDoc.tsx";
import { useDocSet } from "./useDocSet.ts";

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  doc: { boxSizing: "border-box", flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  row: { flexDirection: "row" },
  opened: { animationName: fadeIn, animationDuration: duration.slow, animationTimingFunction: easing.enter },
  alone: { display: "flex", flexDirection: "column", gap: space.s4, padding: space.s5 },
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
  side: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    minHeight: 0,
    backgroundColor: color.surface,
    borderLeftStyle: "solid",
    borderLeftWidth: border.width,
    borderLeftColor: color.border,
  },
  width: (w: number) => ({ width: w }),
  view: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
});

type Drawer = "sections" | "details" | null;

// ponytail: one document — its head, its contents, the part being read (or its figures, or the conversion going on),
// and what the team decides about it; the outer panes fold into drawers as the screen narrows
export function DocDetail({
  id,
  anchor,
  quote = "",
  from,
  onClearQuote,
  onBack,
  fold = "wide",
  panes,
  listOpen = false,
  onShowList,
  onAnchor,
  onRemoved,
}: {
  id: string;
  anchor: string;
  quote?: string;
  from?: QuoteFrom;
  onClearQuote?: () => void;
  onBack?: () => void;
  fold?: Fold;
  panes?: Record<"toc" | "side", Pane>;
  listOpen?: boolean;
  onShowList?: () => void;
  onAnchor: (anchor: string) => void;
  onRemoved: () => void;
}) {
  const client = useQueryClient();
  const meta = useRead("docs.show", { id, brief: true });
  const listed = useRead("docs.list", {}).data?.find?.((d) => d.id === id);
  const running = useUploads().find((u) => u.docId === id && u.job === "convert" && !settled(u));
  const [chosen, setView] = useState<View | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [ask, setAsk] = useState(false);
  const [again, setAgain] = useState(false);
  const [figure, setFigure] = useState<string>();
  const [opened, setOpened] = useState(false);
  const wasRunning = useRef(false);
  const sideFolded = fold === "small" || fold === "tiny";
  const tocFolded = fold === "tiny";

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
      : /^(t|frame):/.test(anchor) && files.some((f) => f.kind === "video")
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

  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      setOpened(true);
    }
  }, [running]);

  useEffect(() => {
    if ((drawer === "details" && !sideFolded) || (drawer === "sections" && !tocFolded)) setDrawer(null);
  }, [drawer, sideFolded, tocFolded]);

  const label = `${shown?.doc.code ?? id} details`;
  if (meta.isError)
    return (
      <section aria-label={label} {...stylex.props(styles.doc)}>
        {onShowList && (
          <span {...stylex.props(styles.alone)}>
            <Button
              variant="quiet"
              iconOnly
              icon="panel-left"
              label="Show the document list"
              expanded={listOpen}
              onClick={onShowList}
            />
          </span>
        )}
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
      <DocLoading
        label={label}
        read="docs.show"
        fold={fold}
        widths={{ toc: panes?.toc.value ?? COLS.toc, side: panes?.side.value ?? COLS.side }}
      />
    );

  const d = { ...shown.doc, type: shown.type, observed: shown.observed };
  const current = (!part.isPlaceholderData && part.data?.section) || target;
  const go = (a: string) => {
    setView("text");
    setDrawer(null);
    onAnchor(a);
  };
  const toc = (head: boolean) => <DocToc sections={sections} current={current} head={head} onGo={go} />;
  const side = <DocSide shown={shown} running={!!running} onStatus={settings.status} />;

  return (
    <section
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
          listOpen={listOpen}
          onShowList={onShowList}
          sectionsButton={tocFolded}
          detailsButton={sideFolded}
          drawer={drawer}
          onDrawer={(w) => setDrawer((o) => (o === w ? null : w))}
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
              <div {...stylex.props(styles.toc, styles.width(panes?.toc.value ?? COLS.toc))}>{toc(true)}</div>
              {panes && <ResizeHandle label="Resize the sections" {...panes.toc} />}
            </>
          )}
          {reading && tocFolded && drawer === "sections" && (
            <Modal title="Contents" drawer="left" flush onClose={() => setDrawer(null)}>
              {toc(false)}
            </Modal>
          )}
          <div {...stylex.props(styles.view)}>
            {running && <DocReading docId={id} upload={running} />}
            {!running && !converted && <ConvertDoc doc={d} />}
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
                quote={onClearQuote && onBack ? { from, onBack, onClear: onClearQuote } : undefined}
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
      {!sideFolded && (
        <>
          {panes && <ResizeHandle label="Resize the settings" side="left" {...panes.side} />}
          <div {...stylex.props(styles.side, styles.width(panes?.side.value ?? COLS.side))}>{side}</div>
        </>
      )}
      {sideFolded && drawer === "details" && (
        <Modal title="About this document" drawer="right" flush onClose={() => setDrawer(null)}>
          {side}
        </Modal>
      )}
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
