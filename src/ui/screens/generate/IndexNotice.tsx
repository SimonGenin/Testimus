import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { plural } from "../../lib/format.ts";

export type Work = "index" | "convert" | "add";

const RUNS: Record<Work, { title: string; label: string }> = {
  index: { title: "Indexing the documents", label: "Index" },
  convert: { title: "Converting a document", label: "Conversion" },
  add: { title: "Adding documents", label: "Adding" },
};

// ponytail: the index gate of the scope, and the document work under way that Generate waits for, named by
// what runs; a document not indexed is out of the scope, the banner says why and offers the reindex
export function IndexNotice({
  missing,
  leftOut,
  stale,
  work,
  progress,
  onShowJob,
  onReindex,
}: {
  missing: string[];
  leftOut: string[];
  stale: string[];
  work: Work | null;
  progress?: { done: number; total: number };
  onShowJob?: () => void;
  onReindex: () => void;
}) {
  const reindex = <Button size="sm" icon="refresh" label="Reindex" onClick={onReindex} />;
  if (work) {
    const p = progress?.total ? progress : null;
    return (
      <Banner
        tone="info"
        title={RUNS[work].title}
        actions={onShowJob && <Button size="sm" variant="quiet" icon="jobs" label="Show the job" onClick={onShowJob} />}
      >
        <Progress
          label={RUNS[work].label}
          value={p ? (p.done / p.total) * 100 : null}
          detail={`${p ? `${p.done} of ${p.total} · ` : ""}Generate waits for it to finish.`}
        />
      </Banner>
    );
  }
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
  if (leftOut.length) {
    const one = leftOut.length === 1;
    return (
      <Banner tone="warning" title="Not indexed" actions={reindex}>
        {leftOut.join(", ")} {one ? "is" : "are"} not indexed: search cannot find {one ? "it" : "them"}, so{" "}
        {one ? "it stays" : "they stay"} out of the scope. Reindex to use {one ? "it" : "them"}.
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
