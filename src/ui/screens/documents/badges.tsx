import type { DocRef } from "../../../core/types.ts";
import { Badge, type BadgeProps, DOC_STATUS } from "../../components/ui/Badge.tsx";

type Word = Pick<BadgeProps, "label" | "tone" | "icon">;

const INDEX: Record<DocRef["indexed"], Word> = {
  fresh: { label: "Indexed", tone: "success", icon: "check" },
  stale: { label: "Not up to date", tone: "warning", icon: "alert-triangle" },
  missing: { label: "Not indexed", tone: "danger", icon: "alert-circle" },
};

const NOT_CONVERTED: Word = { label: "Not converted", tone: "info", icon: "file" };

export const statusWord = (s: string): Word =>
  DOC_STATUS[s as keyof typeof DOC_STATUS] ?? { label: s, tone: "neutral" };

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
