import type { SearchKind, SearchMatch } from "../../../core/types.ts";
import { type IconName, Marked, ReviewBadge } from "../legacy/index.ts";

export const KIND: Record<SearchKind, { label: string; one: string; icon: IconName }> = {
  test: { label: "Tests", one: "test", icon: "tests" },
  document: { label: "Documents", one: "document", icon: "documents" },
  passage: { label: "In the documents", one: "passage", icon: "text" },
};

export function SearchHit({ hit, side = true }: { hit: SearchMatch; side?: boolean }) {
  const second =
    hit.snippet !== undefined ? (
      <>
        {hit.where && <span className="hit-where">{hit.where}</span>}
        <Marked text={hit.snippet} marks={hit.marks} />
      </>
    ) : hit.kind === "test" ? (
      hit.detail?.split(" · ").slice(1).join(" · ")
    ) : (
      hit.detail
    );
  const tag = hit.kind === "test" ? (hit.key ?? "local") : hit.kind === "document" ? "" : hit.docId;
  return (
    <>
      <span className="hit-main">
        <span className="hit-title">
          <Marked text={hit.title} marks={hit.titleMarks} />
        </span>
        {second && <span className="hit-snip">{second}</span>}
      </span>
      {side && (
        <span className="hit-side">
          {hit.why === "meaning" && (
            <span className="hit-why" title="Found by its meaning, not by its words">
              ≈ meaning
            </span>
          )}
          {hit.review && <ReviewBadge review={hit.review} small />}
          {tag && <span className="mono muted hit-key">{tag}</span>}
        </span>
      )}
    </>
  );
}
