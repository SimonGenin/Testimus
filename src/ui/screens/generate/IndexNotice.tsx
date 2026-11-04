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

// ponytail: the index gate of the scope (SPEC §7), and the document work under way that Generate waits for, named by
// what runs
export function IndexNotice({
  missing,
  stale,
  work,
  progress,
  onShowJob,
  onReindex,
}: {
  missing: string[];
  stale: string[];
  work: Work | null;
  progress?: { done: number; total: number };
  onShowJob?: () => void;
  onReindex: () => void;
}) {
  const indexing = work === "index";
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
  if (work) {
    const p = progress?.total ? progress : null;
    return (
      <Banner
        tone="info"
        title={RUNS[work].title}
        actions={onShowJob && <Button size="sm" variant="quiet" icon="jobs" label="Open in Jobs" onClick={onShowJob} />}
      >
        <Progress
          label={RUNS[work].label}
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
