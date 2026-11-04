import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { plural } from "../../lib/format.ts";

export function IndexNotice({
  missing,
  stale,
  indexing,
  progress,
  onShowJob,
  onReindex,
}: {
  missing: string[];
  stale: string[];
  indexing: boolean;
  progress?: { done: number; total: number };
  onShowJob?: () => void;
  onReindex: () => void;
}) {
  const reindex = (
    <Button
      size="sm"
      icon="refresh"
      label={indexing ? "Indexing…" : "Reindex"}
      loading={indexing}
      onClick={onReindex}
    />
  );
  if (missing.length) {
    const one = missing.length === 1;
    return (
      <Banner tone="danger" title="Index not ready" actions={reindex}>
        {plural(missing.length, "document")} in scope {one ? "is" : "are"} not indexed: {missing.join(", ")}. Search
        cannot find {one ? "it" : "them"}, so the tests would have no sources. Reindex, or leave {one ? "it" : "them"}{" "}
        out of the scope.
      </Banner>
    );
  }
  if (indexing) {
    const p = progress?.total ? progress : null;
    return (
      <Banner
        tone="info"
        title="Indexing the documents"
        actions={onShowJob && <Button size="sm" variant="quiet" label="Show the job" onClick={onShowJob} />}
      >
        <Progress
          label="Index"
          value={p ? (p.done / p.total) * 100 : null}
          detail={`${p ? `${p.done} of ${p.total} · ` : ""}Generate waits for it to finish.`}
        />
      </Banner>
    );
  }
  if (!stale.length) return null;
  return (
    <Banner tone="warning" title="Index not up to date" actions={reindex}>
      {stale.join(", ")} changed since the last index: search still finds the previous version.
    </Banner>
  );
}
