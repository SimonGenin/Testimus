import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { useApp } from "../../lib/app.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { desktop, pickFiles } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import { addDocFiles, addDocPath, addDocPaths, forgetSettled, settled, useUploads } from "../../lib/uploads.ts";
import { border, color, fontSize, fontWeight, lineHeight, size, space, z } from "../../styles/tokens.stylex.ts";
import { AddPath } from "./AddPath.tsx";
import { DocDetail } from "./DocDetail.tsx";
import { DocList } from "./DocList.tsx";
import { useDocsLayout } from "./layout.ts";

const styles = stylex.create({
  screen: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: color.canvas,
  },
  notice: { paddingInline: space.s5, paddingTop: space.s3 },
  body: { flex: 1, minHeight: 0, display: "flex", minWidth: 0 },
  list: {
    flex: "none",
    display: "flex",
    minHeight: 0,
    backgroundColor: color.surface,
    borderRightStyle: "solid",
    borderRightWidth: border.width,
    borderRightColor: color.border,
  },
  listWidth: (w: number) => ({ width: w }),
  none: { flex: 1, display: "flex", alignItems: "flex-start", padding: space.s5 },
  empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: space.s7 },
  veil: {
    position: "absolute",
    inset: 0,
    zIndex: z.drawer,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s4,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    borderStyle: "dashed",
    borderWidth: border.widthStrong,
    borderColor: color.accent,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    pointerEvents: "none",
  },
  veilIcon: { display: "inline-flex", width: size.controlLg, height: size.controlLg },
});

const ACCEPT = ".docx,.pdf";

// ponytail: #/documents/<id>#<anchor> "<quote>" — the document, the place in it and the line to mark
function target(arg: string) {
  const hash = arg.indexOf("#");
  const routeId = hash < 0 ? arg : arg.slice(0, hash);
  const at = hash < 0 ? "" : arg.slice(hash + 1);
  const cut = at.indexOf(' "');
  return {
    routeId,
    anchor: cut < 0 ? at : at.slice(0, cut),
    quote: cut < 0 ? "" : at.slice(cut + 2).replace(/"$/, ""),
  };
}

export function DocumentsScreen() {
  const app = useApp();
  const client = useQueryClient();
  const list = useRead("docs.list", {});
  const rag = useRead("rag.status", {});
  const uploads = useUploads();
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const { fold, panes } = useDocsLayout(width);
  const [listOpen, setListOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [askPath, setAskPath] = useState(false);

  const docs = list.data ? (Array.isArray(list.data) ? list.data : []) : list.isError ? [] : undefined;
  const wordsOnly = rag.data?.exists && rag.data.degraded ? rag.data.degraded : null;
  const { routeId, anchor, quote } = target(app.route.screen === "documents" ? (app.route.arg ?? "") : "");
  const activeId = routeId || docs?.[0]?.id || "";
  const active = activeId ? docs?.find((d) => d.id === activeId) : undefined;
  const busy = uploads.filter((u) => !settled(u)).length;
  const hasBody = !(docs && !docs.length && !uploads.length);
  const folded = fold !== "wide";

  useEffect(() => forgetSettled, []);

  useEffect(() => {
    const el = body.current;
    if (!hasBody || !el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, [hasBody]);

  useEffect(() => {
    if (!folded) setListOpen(false);
  }, [folded]);

  const added = (id?: string) => {
    void invalidate(client, [["docs.list"], ["rag.status"]]);
    app.refreshInfo();
    if (id) app.navigate("documents", id);
  };
  const addFiles = (files: File[]) => void addDocFiles(files, added);
  const native = desktop();
  const addButton = (
    <Button
      variant="primary"
      icon="plus"
      label="Add documents"
      pick={native ? undefined : { accept: ACCEPT, multiple: true, onFiles: addFiles }}
      onClick={
        native
          ? () =>
              void pickFiles("Add documents", [{ name: "Word or PDF", extensions: ["docx", "pdf"] }], true).then((p) =>
                addDocPaths(p, added),
              )
          : undefined
      }
    />
  );
  const open = (id: string) => {
    setListOpen(false);
    app.navigate("documents", id);
  };
  const listPane = (head: boolean) => (
    <DocList docs={docs} uploads={uploads} activeId={activeId} head={head} onOpen={open} />
  );
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDrag(true);
  };

  return (
    <div
      data-testid="documents-screen"
      {...stylex.props(styles.screen)}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <ScreenHeader
        title="Documents"
        meta={`${docs?.length ?? 0} document${docs?.length === 1 ? "" : "s"}${busy ? ` · ${busy} in progress` : ""}`}
      >
        <Button variant="quiet" icon="folder-open" label="Add from a path…" onClick={() => setAskPath(true)} />
        {addButton}
      </ScreenHeader>
      {list.isError && (
        <div {...stylex.props(styles.notice)}>
          <Banner tone="danger" title="Could not list the documents">
            {message(list.error)}
          </Banner>
        </div>
      )}
      {wordsOnly && (
        <div {...stylex.props(styles.notice)}>
          <Banner
            tone="warning"
            title="Search on words only"
            actions={
              <Button size="sm" label="Choose a search pack" onClick={() => app.navigate("settings", "models")} />
            }
          >
            {wordsOnly}
          </Banner>
        </div>
      )}
      {!hasBody ? (
        <div {...stylex.props(styles.empty)}>
          <EmptyState
            icon="documents"
            title="No document yet"
            text="Add the specifications this project tests: Word works best, PDF is fine. Drop them anywhere here. Claude reads them to write and check your tests."
            actions={addButton}
          />
        </div>
      ) : (
        <div ref={body} data-testid="docs-body" data-fold={fold} {...stylex.props(styles.body)}>
          {!folded && (
            <>
              <div {...stylex.props(styles.list, styles.listWidth(panes.list.value))}>{listPane(true)}</div>
              <ResizeHandle label="Resize the document list" {...panes.list} />
            </>
          )}
          {folded && listOpen && (
            <Modal title="Documents" drawer="left" flush onClose={() => setListOpen(false)}>
              {listPane(false)}
            </Modal>
          )}
          {active ? (
            <DocDetail
              key={`${activeId} ${active.converted?.at ?? ""}`}
              id={activeId}
              anchor={anchor}
              quote={quote}
              fold={fold}
              panes={panes}
              listOpen={listOpen}
              onShowList={folded ? () => setListOpen((o) => !o) : undefined}
              onAnchor={(a) => app.navigate("documents", `${activeId}#${a}`)}
              onRemoved={() => {
                app.navigate("documents");
                app.refreshInfo();
              }}
            />
          ) : (
            <div {...stylex.props(styles.none)}>
              {folded && (
                <Button
                  variant="quiet"
                  icon="documents"
                  label="Show the document list"
                  expanded={listOpen}
                  onClick={() => setListOpen(true)}
                />
              )}
            </div>
          )}
        </div>
      )}
      {drag && (
        <div data-testid="drop-veil" aria-hidden="true" {...stylex.props(styles.veil)}>
          <span {...stylex.props(styles.veilIcon)}>
            <Icon name="upload" size="lg" />
          </span>
          Drop Word or PDF files to add them
        </div>
      )}
      {askPath && <AddPath onAdd={(p) => void addDocPath(p, added)} onClose={() => setAskPath(false)} />}
    </div>
  );
}
