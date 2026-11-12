import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useEffect, useState } from "react";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { useApp } from "../../lib/app.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { desktop, pickFiles, pickFolder } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import {
  DOC_ACCEPT,
  DOC_EXTENSIONS,
  IMAGE_EXTENSIONS,
  isImage,
  SOUND_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "../../lib/media.ts";
import { OVERVIEW_ROUTE, OVERVIEW_TITLE } from "../../lib/overview.ts";
import {
  addDocs,
  forgetSettled,
  type Picked,
  pickedOfFiles,
  pickedOfPaths,
  settled,
  useUploads,
} from "../../lib/uploads.ts";
import { column, layoutOf, section } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { border, color, radius, space, z } from "../../styles/tokens.stylex.ts";
import { DocDetail } from "./DocDetail.tsx";
import { DocDetails } from "./DocDetails.tsx";
import { DocList } from "./DocList.tsx";
import { DocLoading } from "./DocLoading.tsx";
import { ImagesChoice } from "./ImagesChoice.tsx";
import { ImportFolder } from "./ImportFolder.tsx";
import { OverviewPane } from "./OverviewPane.tsx";

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
  list: { flex: 1, minHeight: 0, minWidth: 0, display: "flex" },
  none: { boxSizing: "border-box", flex: 1, display: "flex", padding: space.s7 },
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

// ponytail: the documents on the left, the one open in the middle, its details and Claude on the right
// (at 1440 px the contents still fit beside the text: 260 + 300 leave the document 790 px)
const LAYOUT = layoutOf(
  column(260, section(["documents"])),
  column(null, section(["document"])),
  column(300, section(["details", "claude"])),
);

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
  return `${why}, so search matches words, not meaning. Choose the search models: they download once, then the documents are indexed again.`;
}

export function DocumentsScreen() {
  const app = useApp();
  const client = useQueryClient();
  const list = useRead("docs.list", {});
  const rag = useRead("rag.status", {});
  const overview = useRead("docs.overviewShow", {});
  const uploads = useUploads();
  const [drag, setDrag] = useState(false);
  const [choosing, setChoosing] = useState<Picked[] | null>(null);
  const [folder, setFolder] = useState<{ picked: string | null } | null>(null);

  const docs = list.data ? (Array.isArray(list.data) ? list.data : []) : list.isError ? [] : undefined;
  const run = rag.data?.indexing ?? null;
  // ponytail: while an index run builds the vectors, words only is its work in progress, not a warning
  const wordsOnly = rag.data?.exists && rag.data.degraded && !run ? wordsOnlyWhy(rag.data) : null;
  const { routeId, anchor, quote, from } = target(app.route.screen === "documents" ? (app.route.arg ?? "") : "");
  // ponytail: a source may name a document by its code — the route opens it by its id
  const named = routeId ? (docs?.find((d) => d.id === routeId) ?? docs?.find((d) => d.code === routeId)) : undefined;
  const activeId = named?.id || routeId || docs?.[0]?.id || "";
  const active = activeId ? docs?.find((d) => d.id === activeId) : undefined;
  const onOverview = routeId === OVERVIEW_ROUTE;
  const unknown = !!docs && !!routeId && !active && !onOverview;
  const busy = uploads.filter((u) => !settled(u)).length;
  const hasBody = !(docs && !docs.length && !uploads.length);

  useEffect(() => forgetSettled, []);

  const added = (id?: string) => {
    void invalidate(client, [["docs.list"], ["rag.status"]]);
    app.refreshInfo();
    if (id) app.navigate("documents", id);
  };
  // ponytail: two images or more picked together ask whether they are one document or one each
  const add = (picked: Picked[]) =>
    picked.filter((p) => isImage(p.name)).length > 1 ? setChoosing(picked) : void addDocs(picked, added);
  const addFiles = (files: File[]) => add(pickedOfFiles(files));
  const native = desktop();
  const addButton = (big = false) => (
    <Button
      variant="primary"
      size={big ? "lg" : "md"}
      icon="plus"
      label="Add documents"
      pick={native ? undefined : { accept: DOC_ACCEPT, multiple: true, onFiles: addFiles }}
      onClick={
        native
          ? () =>
              void pickFiles(
                "Add documents",
                [
                  {
                    name: "Documents, images, videos and sound",
                    extensions: [...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...SOUND_EXTENSIONS],
                  },
                  { name: "Word, PDF or text", extensions: DOC_EXTENSIONS },
                  { name: "Images", extensions: IMAGE_EXTENSIONS },
                  { name: "Videos and sound", extensions: [...VIDEO_EXTENSIONS, ...SOUND_EXTENSIONS] },
                ],
                true,
              ).then((p) => p.length && add(pickedOfPaths(p)))
          : undefined
      }
    />
  );
  const folderButton = (big = false) => (
    <Button
      size={big ? "lg" : "md"}
      icon="folder"
      label="Import a folder…"
      onClick={() =>
        native
          ? void pickFolder("Import a folder").then((picked) => (picked ? setFolder({ picked }) : undefined))
          : setFolder({ picked: null })
      }
    />
  );
  const open = (id: string) => app.navigate("documents", id);
  const claude = useClaudeTab();
  const warned = !!active && (active.converted?.warnings ?? []).length > 0;
  const ws = useWorkspace({
    pref: "layoutDocuments",
    label: "Documents",
    defaults: LAYOUT,
    tabs: [
      {
        id: "documents",
        label: "Documents",
        icon: "documents",
        count: docs?.length,
        content: (
          <div {...stylex.props(styles.list)}>
            <DocList
              docs={docs}
              uploads={uploads}
              activeId={activeId}
              head={false}
              run={run}
              overview={overview.data ?? null}
              onOpen={open}
            />
          </div>
        ),
      },
      {
        id: "document",
        label: "Document",
        icon: onOverview ? "layers" : "text",
        main: true,
        content: !docs ? (
          <DocLoading label="Loading the documents" read="docs.list" />
        ) : !hasBody ? (
          <div {...stylex.props(styles.empty)}>
            <EmptyState
              icon="documents"
              title="No document yet"
              text="Add the specifications your tests come from (.docx preferred, .pdf, .txt) and the photos or videos of the real system. Drop files anywhere on this screen or pick them."
              actions={
                <>
                  {folderButton(true)}
                  {addButton(true)}
                </>
              }
            />
          </div>
        ) : onOverview ? (
          <OverviewPane />
        ) : active ? (
          <DocDetail
            key={`${activeId} ${active.converted?.at ?? ""}`}
            id={activeId}
            anchor={anchor}
            quote={quote}
            from={from}
            onClearQuote={() => app.navigate("documents", `${activeId}#${anchor}`)}
            onAnchor={(a) => app.navigate("documents", `${activeId}#${a}`)}
            onRemoved={() => {
              app.navigate("documents");
              app.refreshInfo();
            }}
          />
        ) : unknown ? (
          <div {...stylex.props(styles.none)}>
            <EmptyState
              icon="documents"
              title="Document not found"
              text={`This project has no document ${routeId}: it was deleted, or the link names another project's.`}
              actions={
                <Button
                  variant="primary"
                  icon="documents"
                  label="Go to Documents"
                  onClick={() => app.navigate("documents")}
                />
              }
            />
          </div>
        ) : (
          <div {...stylex.props(styles.none)}>
            <EmptyState icon="documents" title="No document open" text="Pick a document in the list to read it." />
          </div>
        ),
      },
      {
        id: "details",
        label: "Details",
        icon: "info",
        ...(warned ? { dot: "warning" as const } : {}),
        content: onOverview || !active ? <DocDetails id={null} /> : <DocDetails id={activeId} />,
      },
      claude,
    ],
  });
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
        back={
          from
            ? { to: from.test, away: true, onClick: () => app.navigate(from.screen, from.test) }
            : quote && active
              ? { away: true, onClick: () => window.history.back() }
              : undefined
        }
        crumbs={onOverview ? [OVERVIEW_TITLE] : active ? [`${active.id} · ${active.title || active.id}`] : []}
        meta={busy ? `${busy} in progress` : undefined}
      >
        {folderButton()}
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
              <Button size="sm" label="Choose the search models" onClick={() => app.navigate("settings", "models")} />
            }
          >
            {wordsOnly}
          </Banner>
        </div>
      )}
      {list.isError && !uploads.length ? null : <Workspace ws={ws} />}
      {drag && (
        <div data-testid="drop-veil" aria-hidden="true" {...stylex.props(styles.veil)}>
          <span {...stylex.props(styles.veilMark)}>
            <Icon name="upload" size="lg" />
          </span>
          <span {...stylex.props(type.title, styles.veilTitle)}>Drop files to add them as documents</span>
          <span {...stylex.props(type.compact, styles.veilText)}>
            Word (.docx is preferred: structure and pictures stay intact), PDF, text, images or videos. Each is copied
            into the project, ready to convert; images dropped together can be one document.
          </span>
        </div>
      )}
      {folder && <ImportFolder picked={folder.picked} onClose={() => setFolder(null)} />}
      {choosing && (
        <ImagesChoice
          count={choosing.filter((p) => isImage(p.name)).length}
          onChoose={(choice) => void addDocs(choosing, added, choice)}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  );
}
