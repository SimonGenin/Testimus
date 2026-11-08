import type { DocRef } from "../../../core/types.ts";
import { Badge, type BadgeProps, DOC_STATUS } from "../../components/ui/Badge.tsx";

type Word = Pick<BadgeProps, "label" | "tone" | "icon" | "busy">;

const INDEX: Record<DocRef["indexed"], Word> = {
  fresh: { label: "Indexed", tone: "success", icon: "check" },
  stale: { label: "Not up to date", tone: "warning", icon: "alert-triangle" },
  missing: { label: "Not indexed", tone: "danger", icon: "alert-circle" },
};

const NOT_CONVERTED: Word = { label: "Not converted", tone: "info", icon: "file" };
const WAITING: Word = { label: "Waiting to index", tone: "neutral", icon: "clock" };

export const statusWord = (s: string): Word =>
  DOC_STATUS[s as keyof typeof DOC_STATUS] ?? { label: s, tone: "neutral" };

// ponytail: while an index run reads a document its stale or missing state is the run's work, not a problem — the
// badge says how far the run got (docs.list's indexing), and a warning comes back only if it is still true at the end
export const indexWord = (d: Pick<DocRef, "indexed" | "converted" | "indexing">): Word =>
  !d.converted?.at
    ? NOT_CONVERTED
    : d.indexing?.state === "running"
      ? { label: `Indexing · ${d.indexing.percent} %`, tone: "info", busy: true }
      : d.indexing
        ? WAITING
        : (INDEX[d.indexed] ?? INDEX.missing);

export function DocBadges({ doc }: { doc: DocRef }) {
  const warnings = doc.converted?.warnings ?? [];
  return (
    <>
      <Badge size="sm" {...statusWord(doc.status)} />
      <Badge size="sm" {...indexWord(doc)} />
      {warnings.length > 0 && (
        <Badge
          size="sm"
          tone="warning"
          icon="alert-triangle"
          label={String(warnings.length)}
          tooltip={warnings.join("\n")}
        />
      )}
    </>
  );
}
