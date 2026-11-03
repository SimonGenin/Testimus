import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { DocRef } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { ActionButton } from "../../components/claude/ActionButton.tsx";
import { ActionCount } from "../../components/claude/ActionCount.tsx";
import { problemOf } from "../../components/shell/ProblemPanel.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { DOC_STATUS } from "../../components/sources/PassageView.tsx";
import { TracesBar } from "../../components/traces/TracesBar.tsx";
import { Badge, Button, DragEdge, Icon, IconButton, Modal, Severity, Skeleton } from "../../components/ui/index.ts";
import { useActions } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, pickFiles } from "../../lib/desktop.ts";
import { cx } from "../../lib/format.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";
import {
  addDocFiles,
  addDocPath,
  addDocPaths,
  dismissUpload,
  forgetSettled,
  owns,
  settled,
  type Upload,
  useUploads,
} from "../../lib/uploads.ts";
import { DocDetail } from "./DocDetail.tsx";
import { ImportClaude } from "./ImportClaude.tsx";
import { UploadRow } from "./UploadRow.tsx";

export const INDEX_LOOK = {
  fresh: { tone: "ok" as const, word: "Up to date" },
  stale: { tone: "warning" as const, word: "Reindex needed" },
  missing: { tone: "warning" as const, word: "Not indexed" },
};
const NOT_CONVERTED = { tone: "info" as const, word: "Not converted" };

function IndexFailed({ u, colSpan }: { u: Upload; colSpan: number }) {
  const app = useApp();
  const p = problemOf(u.error ?? new Error(u.message));
  const what = u.phase === "failed" ? "conversion" : "indexing";
  return (
    <tr className="up-row">
      <td colSpan={colSpan}>
        <div className="problem" role="alert">
          <div className="up-fail-head">
            <Severity tone="error">{u.phase === "failed" ? "Conversion failed" : "Indexing failed"}</Severity>
            <span className="spacer" />
            <IconButton
              icon="close"
              label={`Dismiss the ${what} failure of ${u.name}`}
              onClick={() => dismissUpload(u.key)}
            />
          </div>
          <p>
            {u.phase === "failed"
              ? `${u.name} stays as it was: `
              : u.docId
                ? `${u.name} was converted, but search cannot find it yet: `
                : ""}
            {p.detail}
          </p>
          {p.fix && (
            <p>
              <strong>What to do:</strong> {p.fix}
            </p>
          )}
          <div className="problem-actions">
            <Button size="sm" tone="quiet" onClick={() => app.navigate("jobs")}>
              Open Jobs
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

const REFRESH = new Set(["docs.add", "docs.convert", "rag-index", "describe-figures", "claude"]);

export type Fold = "wide" | "medium" | "small" | "tiny";

// ponytail: the outer columns fold first so the text keeps ~480px — list 248, sections 256, settings 300
export const foldOf = (width: number): Fold =>
  width >= 1300 ? "wide" : width >= 1040 ? "medium" : width >= 760 ? "small" : "tiny";

export function DocumentsScreen() {
  const app = useApp();
  const [listW, listEdge] = useSideWidth("testimus.docsListWidth", 200, 420, "before");
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const [listOpen, setListOpen] = useState(false);
  const [docs, setDocs] = useState<DocRef[] | null>(null);
  const [wordsOnly, setWordsOnly] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [askPath, setAskPath] = useState(false);
  const [path, setPath] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const uploads = useUploads();
  const acts = useActions({});
  const arg = app.route.screen === "documents" ? (app.route.arg ?? "") : "";
  const hash = arg.indexOf("#");
  const routeId = hash < 0 ? arg : arg.slice(0, hash);
  const target = hash < 0 ? "" : arg.slice(hash + 1);
  const cut = target.indexOf(' "');
  const anchor = cut < 0 ? target : target.slice(0, cut);
  const quote = cut < 0 ? "" : target.slice(cut + 2).replace(/"$/, "");
  const activeId = routeId || docs?.[0]?.id || "";

  const load = useCallback(() => {
    call<DocRef[]>("docs.list", {})
      .then((r) => setDocs(Array.isArray(r) ? r : []))
      .catch((e) => {
        setDocs([]);
        errorToast(e, "Could not list the documents");
      });
    call<{ exists: boolean; degraded?: string | null }>("rag.status", {})
      .then((r) => setWordsOnly(r?.exists && r.degraded ? r.degraded : null))
      .catch(() => setWordsOnly(null));
  }, []);

  const changed = useCallback(() => {
    load();
    app.refreshInfo();
  }, [load, app]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a project switch lists its own documents
  useEffect(load, [load, app.info?.dir]);

  useEffect(
    () =>
      events((e) => {
        if (e.type === "status" && e.job.status !== "running" && REFRESH.has(e.job.kind)) load();
      }),
    [load],
  );

  useEffect(() => forgetSettled, []);

  const added = (id?: string) => {
    changed();
    if (id) app.navigate("documents", id);
  };
  const add = (files: File[]) => void addDocFiles(files, added);
  const choose = () => {
    if (!desktop()) {
      picker.current?.click();
      return;
    }
    void pickFiles("Add documents", [{ name: "Word or PDF", extensions: ["docx", "pdf"] }], true).then((paths) =>
      addDocPaths(paths, added),
    );
  };

  const busy = uploads.filter((u) => !settled(u));
  const listed = (u: Upload) => !!docs?.some((d) => (u.docId ? d.id === u.docId : owns(u, d)));
  const pages = docs?.length ?? 0;
  const hasBody = !(docs && !docs.length && !uploads.length);
  const fold = foldOf(width);
  const folded = fold !== "wide";

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

  useEffect(() => {
    if (!listOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setListOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen]);

  const active = activeId && docs?.find((d) => d.id === activeId);

  return (
    <div
      className={cx("screen docs-screen", drag && "is-drop")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        add(Array.from(e.dataTransfer.files));
      }}
    >
      <ScreenHeader
        title="Documents"
        meta={`${pages} document${pages === 1 ? "" : "s"}${busy.length ? ` · ${busy.length} in progress` : ""} · drop Word or PDF files anywhere here to add them`}
      >
        <ActionCount actions={acts.filter((a) => a.where.startsWith("doc:"))} />
        <ImportClaude />
        <Button tone="quiet" size="sm" onClick={() => setAskPath(true)}>
          Add from a path
        </Button>
        <Button tone="primary" icon="plus" onClick={choose}>
          Add documents
        </Button>
      </ScreenHeader>
      {wordsOnly && (
        <div className="docs-words-only" role="status">
          <Severity tone="warning">Search on words only</Severity>
          <span>{wordsOnly}</span>
          <Button tone="quiet" size="sm" onClick={() => app.navigate("settings", "models")}>
            Choose a search pack
          </Button>
        </div>
      )}
      {!!docs?.length && (
        <TracesBar hint="none — tell Testimus which ids the documents write (requirements, alarm codes…) to give them a step column." />
      )}
      <input
        ref={picker}
        type="file"
        accept=".docx,.pdf"
        multiple
        hidden
        aria-label="Choose Word or PDF files to add"
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {!hasBody ? (
        <div className="empty">
          <Icon name="documents" size={40} />
          <h2 className="h">Start with the specifications</h2>
          <p>
            Add the documents this project tests. Word works best; PDF is fine. Claude reads them to write and check
            your tests.
          </p>
          <Button tone="primary" onClick={choose}>
            Add documents
          </Button>
          <Button tone="quiet" size="sm" onClick={() => app.navigate("import")}>
            Or import a CSV of existing tests
          </Button>
        </div>
      ) : (
        <div
          ref={body}
          className={cx("docs-body", `is-${fold}`, listOpen && "is-list-open")}
          style={listW ? ({ "--docs-list-w": `${listW}px` } as CSSProperties) : undefined}
        >
          <section className="docs-list scroll" aria-label="Document list">
            <table className="tbl docs-tbl">
              <thead className="sr">
                <tr>
                  <th scope="col">Document</th>
                </tr>
              </thead>
              <tbody>
                {!docs
                  ? [0, 1, 2, 3].map((i) => (
                      <tr key={i} aria-busy="true">
                        <td>
                          <Skeleton w={150} h={10} />
                          <Skeleton w={110} h={14} />
                          <Skeleton w={160} h={18} r={9} />
                        </td>
                      </tr>
                    ))
                  : docs.map((d) => {
                      const st = DOC_STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
                      const ix = !d.convertedAt ? NOT_CONVERTED : (INDEX_LOOK[d.indexed] ?? INDEX_LOOK.missing);
                      const failed = uploads.filter(
                        (u) => u.docId === d.id && (u.phase === "index-failed" || u.phase === "failed"),
                      );
                      const open = () => {
                        setListOpen(false);
                        app.navigate("documents", d.id);
                      };
                      const inFlight = uploads.find((u) => owns(u, d));
                      if (inFlight) return <UploadRow key={d.id} u={inFlight} on={d.id === activeId} onOpen={open} />;
                      return [
                        <tr
                          key={d.id}
                          className={cx(d.id === activeId && "row-on")}
                          aria-selected={d.id === activeId}
                          tabIndex={0}
                          onClick={open}
                          onKeyDown={(e) => e.key === "Enter" && open()}
                        >
                          <td className="tbl-doc" title={`${d.code} · ${d.version} — ${d.title}`}>
                            <div className="mono muted tbl-sub">
                              {d.code} · {d.version}
                            </div>
                            <div className="tbl-title">{d.title}</div>
                            <div className="docs-facts">
                              <Badge tone={st.tone}>{st.label}</Badge>
                              <Severity tone={ix.tone}>{ix.word}</Severity>
                              {d.warnings.length > 0 && (
                                <span title={d.warnings.join("\n")}>
                                  <Severity tone="warning">{String(d.warnings.length)}</Severity>
                                </span>
                              )}
                              {acts
                                .filter((a) => a.where === `doc:${d.id}`)
                                .slice(0, 1)
                                .map((a) => (
                                  <ActionButton key={a.id} action={a} compact />
                                ))}
                            </div>
                          </td>
                        </tr>,
                        ...failed.map((u) => <IndexFailed key={u.key} u={u} colSpan={1} />),
                      ];
                    })}
                {uploads
                  .filter((u) => !listed(u))
                  .map((u) =>
                    u.phase === "index-failed" ? (
                      <IndexFailed key={u.key} u={u} colSpan={1} />
                    ) : (
                      <UploadRow key={u.key} u={u} />
                    ),
                  )}
              </tbody>
            </table>
          </section>
          {!folded && <DragEdge className="docs-list-edge" label="Resize the document list" {...listEdge} />}
          {folded && listOpen && <div className="docs-scrim" aria-hidden="true" onClick={() => setListOpen(false)} />}
          {active ? (
            <DocDetail
              key={`${activeId} ${active.convertedAt ?? ""}`}
              id={activeId}
              anchor={anchor}
              quote={quote}
              fold={fold}
              listOpen={listOpen}
              onShowList={folded ? () => setListOpen((o) => !o) : undefined}
              onAnchor={(a) => app.navigate("documents", `${activeId}#${a}`)}
              onChanged={changed}
              onRemoved={() => {
                app.navigate("documents");
                changed();
              }}
            />
          ) : (
            <div className="docs-none">
              {folded && (
                <Button tone="quiet" icon="documents" onClick={() => setListOpen(true)}>
                  Show the document list
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {drag && (
        <div className="dropveil" aria-hidden="true">
          <Icon name="documents" size={32} />
          <span className="h">Drop Word or PDF files to add them</span>
        </div>
      )}
      {askPath && (
        <Modal
          label="Add a document from a path"
          title="Add a document from a path"
          subtitle="A .docx (preferred) or .pdf on this PC or a synced share. It is copied into the project; the original is never changed."
          width={560}
          onClose={() => setAskPath(false)}
          foot={
            <>
              <span className="spacer" />
              <Button tone="quiet" onClick={() => setAskPath(false)}>
                Cancel
              </Button>
              <Button
                tone="primary"
                disabled={!path.trim()}
                onClick={() => {
                  void addDocPath(path.trim().replace(/^"|"$/g, ""), added);
                  setPath("");
                  setAskPath(false);
                }}
              >
                Add
              </Button>
            </>
          }
        >
          <label className="label" htmlFor="doc-path">
            Path of the file
          </label>
          <input
            id="doc-path"
            className="field mono"
            placeholder="C:\…\SOSIE_211_D401-1_3_01.01.docx"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </Modal>
      )}
    </div>
  );
}
