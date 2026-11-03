import type { DocRef } from "../../../core/types.ts";
import { Button, Severity } from "../../components/legacy/index.ts";
import { plural } from "../../lib/format.ts";

const names = (ds: DocRef[]) => ds.map((d) => d.code || d.id).join(", ");

export function IndexNotice({
  missing,
  stale,
  indexing,
  onReindex,
}: {
  missing: DocRef[];
  stale: DocRef[];
  indexing: boolean;
  onReindex: () => void;
}) {
  if (missing.length) {
    const one = missing.length === 1;
    return (
      <div className="problem gen-index" role="alert">
        <Severity tone="error">Index not ready</Severity>
        <p>
          {plural(missing.length, "document")} in scope {one ? "is" : "are"} not indexed: {names(missing)}. Search
          cannot find {one ? "it" : "them"}, so the tests would have no sources.
        </p>
        <p className="muted">Reindex, or leave {one ? "it" : "them"} out of the scope.</p>
        <div className="problem-actions">
          <Button size="sm" disabled={indexing} onClick={onReindex}>
            {indexing ? "Indexing…" : "Reindex"}
          </Button>
        </div>
      </div>
    );
  }
  if (!stale.length) return null;
  return (
    <div className="gen-index-stale" role="status">
      <Severity tone="warning">Index not up to date</Severity>
      <span>
        {names(stale)} changed since the last index: search still finds the previous version.{" "}
        {indexing ? (
          "Indexing…"
        ) : (
          <button type="button" className="linkbtn" onClick={onReindex}>
            Reindex
          </button>
        )}
      </span>
    </div>
  );
}
