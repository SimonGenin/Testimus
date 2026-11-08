import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { desktop, pickFiles } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import { isPhoto } from "../../lib/media.ts";
import { addDocFiles, addDocPaths, forgetSettled, settled, useUploads } from "../../lib/uploads.ts";
import { border, color, radius, space, z } from "../../styles/tokens.stylex.ts";
import { type PickedFile, pickedOf } from "./BatchFiles.tsx";
import { DocDetail } from "./DocDetail.tsx";
import { DocList } from "./DocList.tsx";
import { DocLoading } from "./DocLoading.tsx";
import { useDocsLayout } from "./layout.ts";
import { NewBatch } from "./NewBatch.tsx";

const styles = stylex.create({
  screen: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: color.surface,
  },
  notice: {
    flex: "none",
    paddingBlock: space.s3,
    paddingInline: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  body: { flex: 1, minHeight: 0, display: "flex", minWidth: 0 },
  list: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    minHeight: 0,
    backgroundColor: color.surface,
    borderRightStyle: "solid",
    borderRightWidth: border.width,
    borderRightColor: color.border,
  },
  listWidth: (w: number) => ({ width: w }),
  none: { boxSizing: "border-box", flex: 1, display: "flex", alignItems: "flex-start", padding: space.s5 },
  empty: { flex: 1, minHeight: 0, overflowY: "auto" },
  veil: {
    boxSizing: "border-box",
    position: "absolute",
    inset: space.s3,
    zIndex: z.modal,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    paddingInline: space.s7,
    textAlign: "center",
    backgroundColor: `color-mix(in srgb, ${color.surface} 88%, transparent)`,
    borderStyle: "dashed",
    borderWidth: border.widthStrong,
    borderColor: color.accent,
    borderRadius: radius.r4,
    pointerEvents: "none",
  },
  veilMark: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: space.s11,
    height: space.s11,
    borderRadius: radius.full,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
  },
  veilTitle: { color: color.text },
  veilText: { color: color.textMuted },
});

const ACCEPT = ".docx,.pdf";

// ponytail: #/documents/<id>#<anchor> "<quote>" from [review ]<test> step <n> — the document, the place in it, the
// line to mark and the test that cited it, read in Review or in Tests (the last part is optional)
function target(arg: string) {
  const hash = arg.indexOf("#");
  const routeId = hash < 0 ? arg : arg.slice(0, hash);
  const at = hash < 0 ? "" : arg.slice(hash + 1);
  const cut = at.indexOf(' "');
  const rest = cut < 0 ? "" : at.slice(cut + 2);
  const m = /^([\s\S]*)" from (?:(review) )?(\S+)(?: step (\d+))?$/.exec(rest);
  return {
    routeId,
    anchor: cut < 0 ? at : at.slice(0, cut),
    quote: m ? m[1] : rest.replace(/"$/, ""),
    from: m
      ? { test: m[3], screen: m[2] ? ("review" as const) : ("tests" as const), ...(m[4] && { step: Number(m[4]) }) }
      : undefined,
  };
}

// ponytail: why search matches words only on this PC, and what choosing a search pack does about it
function wordsOnlyWhy(r: { embedding: string; space: { complete: boolean } | null }): string {
  const model = r.embedding && r.embedding !== "none" ? r.embedding : "";
  const why = !model
    ? "This PC has no search pack yet"
    : r.space
      ? `The vectors of ${model} on this PC are incomplete`
      : `This PC has no vectors for ${model} yet`;
  return `${why}, so search matches words, not meaning. Choose a search pack: its models download once, then the documents are indexed again.`;
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
  const [drag, setDrag] = useState<"docs" | "photos" | false>(false);
  const [dropped, setDropped] = useState<PickedFile[] | null>(null);

  const docs = list.data ? (Array.isArray(list.data) ? list.data : []) : list.isError ? [] : undefined;
  const run = rag.data?.indexing ?? null;
  // ponytail: while an index run builds the vectors, words only is its work in progress, not a warning
  const wordsOnly = rag.data?.exists && rag.data.degraded && !run ? wordsOnlyWhy(rag.data) : null;
  const { routeId, anchor, quote, from } = target(app.route.screen === "documents" ? (app.route.arg ?? "") : "");
  // ponytail: a source may name a document by its code — the route opens it by its id
  const named = routeId ? (docs?.find((d) => d.id === routeId) ?? docs?.find((d) => d.code === routeId)) : undefined;
  const activeId = named?.id || routeId || docs?.[0]?.id || "";
  const active = activeId ? docs?.find((d) => d.id === activeId) : undefined;
  const unknown = !!docs && !!routeId && !active;
  const busy = uploads.filter((u) => !settled(u)).length;
  const hasBody = !(docs && !docs.length && !uploads.length);
  const folded = fold !== "wide";

  useEffect(() => forgetSettled, []);

  // ponytail: measured before the first paint — the wide layout drawn for one frame on a narrow window showed the list
  // the drawer then took away
  useLayoutEffect(() => {
    const el = body.current;
    if (!hasBody || !el || typeof ResizeObserver === "undefined") return;
    setWidth(el.getBoundingClientRect().width);
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
  const addButton = (big = false) => (
    <Button
      variant="primary"
      size={big ? "lg" : "md"}
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
    <DocList docs={docs} uploads={uploads} activeId={activeId} head={head} run={run} onOpen={open} />
  );
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    // ponytail: photos dropped while a document is open become a batch of it; the browser names their type while dragging
    const items = Array.from(e.dataTransfer.items ?? []);
    setDrag(active && items.length > 0 && items.every((i) => i.type.startsWith("image/")) ? "photos" : "docs");
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
        const all = Array.from(e.dataTransfer.files);
        const photos = active ? all.filter((f) => isPhoto(f.name)) : [];
        if (photos.length) setDropped(pickedOf(photos));
        const rest = all.filter((f) => !photos.includes(f));
        if (rest.length) addFiles(rest);
      }}
    >
      <ScreenHeader
        title="Documents"
        crumbs={active ? [`${active.id} · ${active.title || active.id}`] : []}
        meta={busy ? `${busy} in progress` : undefined}
      >
        {addButton()}
      </ScreenHeader>
      {list.isError && (
        <div {...stylex.props(styles.notice)}>
          <Banner
            tone="danger"
            title="Could not list the documents"
            actions={<Button size="sm" icon="refresh" label="Retry" onClick={() => void list.refetch()} />}
          >
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
      {list.isError && !uploads.length ? null : !hasBody ? (
        <div {...stylex.props(styles.empty)}>
          <EmptyState
            icon="documents"
            title="No document yet"
            text="Add the specifications your tests come from: .docx (preferred) or .pdf. Drop files anywhere on this screen or pick them."
            actions={addButton(true)}
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
          {!docs ? (
            <DocLoading
              label="Loading the documents"
              fold={fold}
              widths={{ toc: panes.toc.value, side: panes.side.value }}
            />
          ) : active ? (
            <DocDetail
              key={`${activeId} ${active.converted?.at ?? ""}`}
              id={activeId}
              anchor={anchor}
              quote={quote}
              from={from}
              onClearQuote={() => app.navigate("documents", `${activeId}#${anchor}`)}
              onBack={() => (from ? app.navigate(from.screen, from.test) : window.history.back())}
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
          ) : unknown ? (
            <div {...stylex.props(styles.empty)}>
              <EmptyState
                icon="documents"
                title="Document not found"
                text={`This project has no document ${routeId}: it was deleted, or the link names another project's.`}
                actions={
                  <>
                    {folded && (
                      <Button
                        variant="quiet"
                        icon="panel-left"
                        label="Show the document list"
                        expanded={listOpen}
                        onClick={() => setListOpen(true)}
                      />
                    )}
                    {from && (
                      <Button
                        icon="arrow-left"
                        label="Back to the test"
                        onClick={() => app.navigate(from.screen, from.test)}
                      />
                    )}
                    <Button
                      variant="primary"
                      icon="documents"
                      label="Go to Documents"
                      onClick={() => app.navigate("documents")}
                    />
                  </>
                }
              />
            </div>
          ) : (
            <div {...stylex.props(styles.none)}>
              {folded && (
                <Button
                  variant="quiet"
                  icon="panel-left"
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
          <span {...stylex.props(styles.veilMark)}>
            <Icon name="upload" size="lg" />
          </span>
          {drag === "photos" && active ? (
            <>
              <span {...stylex.props(type.title, styles.veilTitle)}>Drop photos to add them to {active.code}</span>
              <span {...stylex.props(type.compact, styles.veilText)}>
                They become a batch of the document: Claude reads them with the context you give, and the batch is an
                annex at the end of the document.
              </span>
            </>
          ) : (
            <>
              <span {...stylex.props(type.title, styles.veilTitle)}>Drop Word or PDF files to add them</span>
              <span {...stylex.props(type.compact, styles.veilText)}>
                .docx is preferred — structure and pictures stay intact; .pdf is the fallback. Each file is copied into
                the project, ready to convert. Photos dropped on an open document become a batch of it.
              </span>
            </>
          )}
        </div>
      )}
      {dropped && active && <NewBatch doc={active} files={dropped} onClose={() => setDropped(null)} />}
    </div>
  );
}
