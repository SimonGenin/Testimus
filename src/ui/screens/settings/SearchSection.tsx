import { useCallback, useEffect, useState } from "react";
import type { RagChoice } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Badge, Button, Icon, Severity, Skeleton } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { plural, relTime } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { reindexAll, useUploads } from "../../lib/uploads.ts";
import { ConfirmDialog } from "./models/ConfirmDialog.tsx";
import type { CatalogRow, RagStatus } from "./models/data.ts";
import { choiceLabel, ORIGIN } from "./models/data.ts";

export type Space = {
  id: string;
  model: string;
  runtime: string;
  dims: number;
  chunks: number;
  complete: boolean;
  active: boolean;
  builtAt: string | null;
  lastUsed: string | null;
  sizeMB: number;
};

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? relTime(Date.parse(iso)) : "—");

export function SearchSection() {
  const app = useApp();
  const [st, setSt] = useState<RagStatus | null>(null);
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState("");
  const [dropping, setDropping] = useState<Space | null>(null);
  const uploads = useUploads();
  const indexing = uploads.some((u) => u.phase === "indexing");
  const load = useCallback(() => {
    call<RagStatus>("rag.status", {})
      .then((r) => {
        setSt(r);
        setFailed("");
      })
      .catch((e) => {
        setSt(null);
        setFailed(e instanceof Error ? e.message : String(e));
      });
    call<Space[]>("rag.spaces", {})
      .then((r) => setSpaces(r ?? []))
      .catch(() => setSpaces([]));
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reread when an index run ends or the project changes
  useEffect(load, [load, indexing, app.info?.dir]);
  useEffect(() => {
    call<CatalogRow[]>("models.catalog", {})
      .then((r) => setLabels(Object.fromEntries((r ?? []).map((c) => [c.id, c.label]))))
      .catch(() => {});
  }, []);
  if (!app.info) return null;
  const label = (id: string) => labels[id] ?? id;
  const reference = app.info.project.rag?.reference as RagChoice | undefined;
  const fresh = !!st?.exists && st.profileMatches && st.docs.every((d) => d.indexed === "fresh");
  const behind = st?.docs.filter((d) => d.indexed !== "fresh").length ?? 0;

  const drop = async () => {
    const s = dropping;
    setDropping(null);
    if (!s) return;
    try {
      const r = await call<{ dropped: string; freedMB: number }>("rag.dropSpace", { id: s.id, force: s.active });
      toast({ kind: "ok", title: "Vector space dropped", detail: `${r.dropped} · ${r.freedMB} MB freed` });
    } catch (e) {
      errorToast(e, "Could not drop the vector space");
    }
    load();
  };

  return (
    <section className="card sect" id="settings-search" aria-labelledby="s-search">
      <div className="sect-head">
        <h2 id="s-search" className="h sect-title">
          Search
        </h2>
        <span className="spacer" />
        <Button size="sm" tone="quiet" onClick={() => app.navigate("settings", "models")}>
          Choose models…
        </Button>
      </div>
      {failed ? (
        <Severity tone="error">The index state could not be read: {failed}</Severity>
      ) : (
        <dl className="search-facts">
          <dt>Team reference</dt>
          <dd>
            {reference ? choiceLabel(reference, label) : <span className="muted">Not set: the Light pack</span>}
            <span className="muted"> · in project.json, shared with the team</span>
          </dd>
          <dt>Used on this PC</dt>
          <dd>
            {!st ? (
              <Skeleton w={260} h={14} />
            ) : (
              <span className="search-used">
                {st.embedding === "none" ? (
                  <span>No embedding model</span>
                ) : (
                  <span>
                    {label(st.embedding)}
                    <span className="muted"> + </span>
                    {st.reranker ? label(st.reranker) : <span className="muted">no reranker</span>}
                  </span>
                )}
                <Badge tone={st.activation === "none" ? "warn" : "line"} small title="Where this choice comes from">
                  {ORIGIN[st.activation]}
                </Badge>
              </span>
            )}
          </dd>
          {st && st.missing.length > 0 && (
            <>
              <dt>Not on this PC</dt>
              <dd>
                <Severity tone="warning">{st.missing.map(label).join(", ")}</Severity>
                <span className="muted"> · install them in Models, or another choice is used</span>
              </dd>
            </>
          )}
        </dl>
      )}
      {st?.degraded && (
        <div className="degraded" role="status">
          <Severity tone="warning">Search on words only</Severity>
          <span>{st.degraded}</span>
        </div>
      )}
      <div className="sect-head">
        {!st ? (
          <Skeleton w={220} h={14} />
        ) : indexing ? (
          <span className="sev s-run">
            <span className="dot run-dot" />
            Indexing…
          </span>
        ) : fresh ? (
          <Severity tone="ok">Index up to date · {plural(st.chunks, "passage")}</Severity>
        ) : !st.exists ? (
          <Severity tone="warning">No index yet</Severity>
        ) : (
          <Severity tone="warning">
            {!st.profileMatches
              ? "Vectors missing for this model — reindex"
              : `${plural(behind, "document")} to reindex`}
          </Severity>
        )}
        <span className="spacer" />
        <Button size="sm" disabled={indexing} onClick={() => void reindexAll(load)}>
          Reindex
        </Button>
      </div>
      <div className="spaces">
        <span className="label">Vector spaces in this index</span>
        {!spaces ? (
          <Skeleton h={60} />
        ) : !spaces.length ? (
          <p className="muted">None yet: the first index run with an embedding model builds one.</p>
        ) : (
          <table className="tbl spaces-tbl" aria-label="Vector spaces">
            <thead>
              <tr>
                <th>Model</th>
                <th>Vectors</th>
                <th>Size</th>
                <th>State</th>
                <th>Last used</th>
                <th>
                  <span className="sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id} aria-label={`Space ${s.id}`}>
                  <td>
                    <div className="mname">
                      <span className="mname-label">{label(s.model)}</span>
                      <span className="muted mono mname-id">
                        {s.id} · {s.runtime} · {s.dims} dims
                      </span>
                    </div>
                  </td>
                  <td className="num-cell">{s.chunks}</td>
                  <td className="num-cell">{s.sizeMB} MB</td>
                  <td>
                    <span className="chips">
                      {s.complete ? (
                        <Severity tone="ok">Complete</Severity>
                      ) : (
                        <Severity tone="warning">Incomplete</Severity>
                      )}
                      {s.active && (
                        <Badge tone="ok" icon="check" small>
                          In use here
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="muted">{when(s.lastUsed ?? s.builtAt)}</td>
                  <td>
                    <Button
                      size="sm"
                      tone="quiet"
                      icon="trash"
                      aria-label={`Drop space ${s.id}`}
                      onClick={() => setDropping(s)}
                    >
                      Drop
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted">
        <Icon name="lock" size={12} /> Documents are indexed on this PC and never sent elsewhere. Each model keeps its
        own vectors: switching back to a model already indexed is quick.
      </p>
      {dropping && (
        <ConfirmDialog
          title={`Drop the ${label(dropping.model)} vectors?`}
          confirm={`Drop ${dropping.sizeMB} MB`}
          onConfirm={() => void drop()}
          onClose={() => setDropping(null)}
        >
          <p>
            {dropping.chunks} vectors are deleted from the index. Using this model again embeds the documents again.
          </p>
          {dropping.active && (
            <Severity tone="warning">
              This PC searches with it: search falls back to words only until you reindex.
            </Severity>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
