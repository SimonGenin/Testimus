import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { DocJson } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { key, useCommand, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { border, color, duration, easing, space } from "../../styles/tokens.stylex.ts";
import { ConvertDoc } from "./ConvertDoc.tsx";
import { DocFigures } from "./DocFigures.tsx";
import { DocHead, type View } from "./DocHead.tsx";
import { DocPart } from "./DocPart.tsx";
import { DocReading } from "./DocReading.tsx";
import { DocSide } from "./DocSide.tsx";
import { DocToc } from "./DocToc.tsx";
import { COLS, type Fold, type Pane } from "./layout.ts";
import { RemoveDoc } from "./RemoveDoc.tsx";

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  doc: { boxSizing: "border-box", flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  opened: { animationName: fadeIn, animationDuration: duration.slow, animationTimingFunction: easing.enter },
  alone: { display: "flex", flexDirection: "column", gap: space.s4, padding: space.s5 },
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

type Shown = CommandOutput<"docs.show">;
type Drawer = "sections" | "details" | null;

// ponytail: one document — its head, its contents, the part being read (or its figures, or the conversion going on),
// and what the team decides about it; the outer panes fold into drawers as the screen narrows
export function DocDetail({
  id,
  anchor,
  quote = "",
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
  fold?: Fold;
  panes?: Record<"toc" | "side", Pane>;
  listOpen?: boolean;
  onShowList?: () => void;
  onAnchor: (anchor: string) => void;
  onRemoved: () => void;
}) {
  const client = useQueryClient();
  const meta = useRead("docs.show", { id, brief: true });
  const running = useUploads().find((u) => u.docId === id && u.job === "convert" && !settled(u));
  const [view, setView] = useState<View>("text");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [ask, setAsk] = useState(false);
  const [again, setAgain] = useState(false);
  const [opened, setOpened] = useState(false);
  const wasRunning = useRef(false);
  const sideFolded = fold === "small" || fold === "tiny";
  const tocFolded = fold === "tiny";

  const shown = meta.data;
  const sections = shown?.toc ?? [];
  const converted = !!shown?.doc.converted?.at;
  const reading = !!shown && !running && converted;
  const target = anchor || sections.find((t) => t.level > 1)?.anchor || sections[0]?.anchor || "";
  const part = useRead("docs.show", target ? { id, anchor: target } : { id }, {
    enabled: reading && view === "text",
    keepPrevious: true,
  });

  const status = useCommand("docs.set", {
    invalidates: [["docs.list"]],
    optimistic: (c, input) => {
      const k = key("docs.show", { id, brief: true }) as unknown as readonly unknown[];
      const before = c.getQueryData<Shown>(k);
      if (before && input.status) c.setQueryData<Shown>(k, { ...before, doc: { ...before.doc, status: input.status } });
      return () => c.setQueryData(k, before);
    },
  });

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
      <section aria-label={label} {...stylex.props(styles.doc, styles.alone)}>
        {onShowList && (
          <span>
            <Button
              variant="quiet"
              iconOnly
              icon="documents"
              label="Show the document list"
              expanded={listOpen}
              onClick={onShowList}
            />
          </span>
        )}
        <Banner tone="danger" title="This document could not be opened">
          {message(meta.error)}
        </Banner>
      </section>
    );
  if (!shown)
    return (
      <section aria-label={label} aria-busy="true" {...stylex.props(styles.doc, styles.alone)}>
        <Skeleton kind="title" width="40%" />
        <Skeleton width="60%" />
        <Skeleton kind="block" />
      </section>
    );

  const d = shown.doc;
  const current = (!part.isPlaceholderData && part.data?.section) || target;
  const go = (a: string) => {
    setView("text");
    setDrawer(null);
    onAnchor(a);
  };
  const setStatus = (s: DocJson["status"]) =>
    status.mutate(
      { id, status: s },
      {
        onSuccess: (doc) =>
          client.setQueryData<Shown>(key("docs.show", { id, brief: true }) as unknown as readonly unknown[], (old) =>
            old ? { ...old, doc } : old,
          ),
        onError: (e) => errorToast(e, "Could not save the document"),
      },
    );
  const toc = (head: boolean) => <DocToc sections={sections} current={current} head={head} onGo={go} />;
  const side = <DocSide shown={shown} running={!!running} onStatus={setStatus} />;

  return (
    <section
      aria-label={`${d.code} details`}
      data-opened={opened || undefined}
      {...stylex.props(styles.doc, opened && styles.opened)}
    >
      <DocHead
        doc={d}
        sections={sections.length}
        figures={shown.figures.length}
        running={!!running}
        view={view}
        onView={setView}
        listOpen={listOpen}
        onShowList={onShowList}
        sectionsButton={tocFolded}
        detailsButton={sideFolded}
        drawer={drawer}
        onDrawer={(w) => setDrawer((o) => (o === w ? null : w))}
        onConvertAgain={() => setAgain(true)}
        onDelete={() => setAsk(true)}
      />
      <div {...stylex.props(styles.body)}>
        {reading && !tocFolded && (
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
          {reading && view === "figures" && <DocFigures docId={id} figures={shown.figures} onOpen={go} />}
          {reading && view === "text" && (
            <DocPart
              docId={id}
              sections={sections}
              current={current}
              md={part.isError ? message(part.error) : (part.data?.md ?? "")}
              loading={!part.data && !part.isError}
              focus={quote || undefined}
              onGo={go}
            />
          )}
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
      </div>
      {again && <ConvertDoc doc={d} again onClose={() => setAgain(false)} />}
      {ask && <RemoveDoc doc={d} onClose={() => setAsk(false)} onRemoved={onRemoved} />}
    </section>
  );
}
