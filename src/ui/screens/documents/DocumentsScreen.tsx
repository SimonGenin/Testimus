import { useCallback, useEffect, useRef, useState } from "react";
import type { DocRef } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { ProblemPanel, problemOf } from "../../components/shell/ProblemPanel.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { BINDING, DOC_STATUS } from "../../components/sources/PassageView.tsx";
import { TracesBar } from "../../components/traces/TracesBar.tsx";
import { Badge, Button, Icon, IconButton, Modal, Severity, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, pickFiles } from "../../lib/desktop.ts";
import { cx } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import {
  addDocFiles,
  addDocPath,
  addDocPaths,
  dismissUpload,
  forgetSettled,
  reindexAll,
  settled,
  type Upload,
  useUploads,
} from "../../lib/uploads.ts";
import { DocDetail } from "./DocDetail.tsx";

export const INDEX_LOOK = {
  fresh: { tone: "ok" as const, word: "Up to date" },
  stale: { tone: "warning" as const, word: "Reindex needed" },
  missing: { tone: "warning" as const, word: "Not indexed" },
};

function IndexFailed({ u, colSpan, onReindex }: { u: Upload; colSpan: number; onReindex: () => void }) {
  const app = useApp();
  const p = problemOf(u.error ?? new Error(u.message));
  return (
    <tr className="up-row">
      <td colSpan={colSpan}>
        <div className="problem" role="alert">
          <div className="up-fail-head">
            <Severity tone="error">Indexing failed</Severity>
            <span className="spacer" />
            <IconButton
              icon="close"
              label={`Dismiss the indexing failure of ${u.name}`}
              onClick={() => dismissUpload(u.key)}
            />
          </div>
          <p>
            {u.docId ? `${u.name} was added, but search cannot find it yet: ` : ""}
            {p.detail}
          </p>
          {p.fix && (
            <p>
              <strong>What to do:</strong> {p.fix}
            </p>
          )}
          <div className="problem-actions">
            <Button
              size="sm"
              icon="revert"
              onClick={() => {
                dismissUpload(u.key);
                onReindex();
              }}
            >
              Reindex
            </Button>
            <Button size="sm" tone="quiet" onClick={() => app.navigate("jobs")}>
              Open Jobs
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function UploadRow({ u, onReindex }: { u: Upload; onReindex: () => void }) {
  if (u.phase === "index-failed") return <IndexFailed u={u} colSpan={5} onReindex={onReindex} />;
  return (
    <tr className="up-row">
      <td className="tbl-doc" title={u.name}>
        <div className="mono muted tbl-sub">{u.docId ?? "New document"}</div>
        <div className="tbl-title">{u.name}</div>
      </td>
      <td colSpan={4}>
        {u.phase === "failed" ? (
          <div className="up-fail">
            <ProblemPanel
              error={u.error ?? new Error(u.message)}
              doing={`Adding ${u.name}`}
              untouched="Nothing else changed in the project."
            />
            <IconButton icon="close" label={`Dismiss ${u.name}`} onClick={() => dismissUpload(u.key)} />
          </div>
        ) : u.phase === "done" ? (
          <Severity tone="ok">Added and indexed</Severity>
        ) : (
          <div className="up-prog">
            <span>
              {u.phase === "reading" ? "Reading" : u.phase === "converting" ? "Converting" : "Indexing"}
              {u.pct !== null ? ` · ${u.pct}%` : ""}
            </span>
            <div
              className="prog"
              role="progressbar"
              aria-label={u.phase === "indexing" ? "Indexing" : "Converting"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={u.pct ?? undefined}
            >
              <span style={{ width: `${u.pct ?? 35}%` }} className={u.pct === null ? "prog-busy" : undefined} />
            </div>
            <span className="muted">{u.phase === "indexing" ? u.message : "then indexing"}</span>
          </div>
        )}
      </td>
    </tr>
  );
}

const REFRESH = new Set(["docs.add", "docs.convert", "rag-index", "describe-figures"]);

export function DocumentsScreen() {
  const app = useApp();
  const [docs, setDocs] = useState<DocRef[] | null>(null);
  const [wordsOnly, setWordsOnly] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [askPath, setAskPath] = useState(false);
  const [path, setPath] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const uploads = useUploads();
  const arg = app.route.screen === "documents" ? (app.route.arg ?? "") : "";
  const hash = arg.indexOf("#");
  const routeId = hash < 0 ? arg : arg.slice(0, hash);
  const anchor = hash < 0 ? "" : arg.slice(hash + 1);
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

  const add = (files: File[]) => void addDocFiles(files, changed);
  const choose = () => {
    if (!desktop()) {
      picker.current?.click();
      return;
    }
    void pickFiles("Add documents", [{ name: "Word or PDF", extensions: ["docx", "pdf"] }], true).then((paths) =>
      addDocPaths(paths, changed),
    );
  };

  const busy = uploads.filter((u) => !settled(u));
  const listed = (u: Upload) => !!u.docId && !!docs?.some((d) => d.id === u.docId);
  const reindex = () => void reindexAll(changed);
  const pages = docs?.length ?? 0;

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
        meta={`${pages} document${pages === 1 ? "" : "s"}${busy.length ? ` · ${busy.length} being added` : ""} · drop Word or PDF files anywhere here to add them`}
      >
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
      {docs && !docs.length && !uploads.length ? (
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
        <div className="split">
          <section className="split-main scroll" aria-label="Document list">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  <th scope="col">Binding</th>
                  <th scope="col">Search</th>
                  <th scope="col">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {!docs
                  ? [0, 1, 2, 3].map((i) => (
                      <tr key={i} aria-busy="true">
                        <td>
                          <Skeleton w={170} h={10} />
                          <Skeleton w={110} h={14} />
                        </td>
                        <td>
                          <Skeleton w={80} h={22} r={11} />
                        </td>
                        <td>
                          <Skeleton w={70} h={12} />
                        </td>
                        <td>
                          <Skeleton w={90} h={14} />
                        </td>
                        <td>
                          <Skeleton w={20} h={12} />
                        </td>
                      </tr>
                    ))
                  : docs.map((d) => {
                      const st = DOC_STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
                      const ix = INDEX_LOOK[d.indexed] ?? INDEX_LOOK.missing;
                      const mine = uploads.filter((u) => u.docId === d.id);
                      const running = mine.find((u) => u.phase === "indexing");
                      const failed = mine.filter((u) => u.phase === "index-failed");
                      return [
                        <tr
                          key={d.id}
                          className={cx(d.id === activeId && "row-on")}
                          aria-selected={d.id === activeId}
                          tabIndex={0}
                          onClick={() => app.navigate("documents", d.id)}
                          onKeyDown={(e) => e.key === "Enter" && app.navigate("documents", d.id)}
                        >
                          <td className="tbl-doc" title={`${d.code} · ${d.version} — ${d.title}`}>
                            <div className="mono muted tbl-sub">
                              {d.code} · {d.version}
                            </div>
                            <div className="tbl-title">{d.title}</div>
                          </td>
                          <td>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </td>
                          <td>{BINDING[d.binding] ?? d.binding}</td>
                          <td className="tbl-state">
                            {running ? (
                              <span className="sev s-run">
                                <span className="dot run-dot" />
                                Indexing{running.pct !== null ? ` · ${running.pct}%` : ""}
                              </span>
                            ) : (
                              <Severity tone={ix.tone}>{ix.word}</Severity>
                            )}
                          </td>
                          <td>
                            {d.warnings.length ? (
                              <span title={d.warnings.join("\n")}>
                                <Severity tone="warning">{String(d.warnings.length)}</Severity>
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>,
                        ...failed.map((u) => <IndexFailed key={u.key} u={u} colSpan={5} onReindex={reindex} />),
                      ];
                    })}
                {uploads
                  .filter((u) => !listed(u))
                  .map((u) => (
                    <UploadRow key={u.key} u={u} onReindex={reindex} />
                  ))}
              </tbody>
            </table>
          </section>
          {activeId && docs?.some((d) => d.id === activeId) && (
            <DocDetail
              key={activeId}
              id={activeId}
              anchor={anchor}
              docs={docs ?? []}
              onAnchor={(a) => app.navigate("documents", `${activeId}#${a}`)}
              onChanged={changed}
              onReindex={reindex}
            />
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
                  void addDocPath(path.trim().replace(/^"|"$/g, ""), changed);
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
