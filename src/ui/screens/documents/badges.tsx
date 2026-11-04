import type { DocJson, DocRef } from "../../../core/types.ts";
import { Badge, type BadgeProps } from "../../components/ui/Badge.tsx";

type Word = Pick<BadgeProps, "label" | "tone" | "icon">;

const STATUS: Record<DocJson["status"], Word> = {
  draft: { label: "Draft", tone: "neutral", icon: "circle-dashed" },
  submitted: { label: "Submitted", tone: "info", icon: "upload" },
  validated: { label: "Validated", tone: "success", icon: "validated" },
};

const INDEX: Record<DocRef["indexed"], Word> = {
  fresh: { label: "Indexed", tone: "success", icon: "check" },
  stale: { label: "Reindex needed", tone: "warning", icon: "refresh" },
  missing: { label: "Not indexed", tone: "warning", icon: "alert-triangle" },
};

const NOT_CONVERTED: Word = { label: "Not converted", tone: "info", icon: "file" };

export const statusWord = (s: string): Word => STATUS[s as DocJson["status"]] ?? { label: s, tone: "neutral" };

export const indexWord = (d: Pick<DocRef, "indexed" | "converted">): Word =>
  !d.converted?.at ? NOT_CONVERTED : (INDEX[d.indexed] ?? INDEX.missing);

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
