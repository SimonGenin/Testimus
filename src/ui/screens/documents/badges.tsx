import type { DocRef } from "../../../core/types.ts";
import { DocStage } from "../../components/sources/DocStage.tsx";
import { Badge, type BadgeProps, DOC_STATUS } from "../../components/ui/Badge.tsx";
import { stageOf, stageWord } from "../../lib/stage.ts";

type Word = Pick<BadgeProps, "label" | "tone" | "icon" | "busy" | "tooltip">;

export const statusWord = (s: string): Word =>
  DOC_STATUS[s as keyof typeof DOC_STATUS] ?? { label: s, tone: "neutral" };

// ponytail: the words of a document's stage (docs.list's stage) — while an index run reads a document its stale or
// missing state is the run's work, not a problem: the stage says how far the run got
export const indexWord = (
  d: Pick<DocRef, "indexed" | "converted" | "indexing"> & Partial<Pick<DocRef, "stage">>,
): Word => stageWord(stageOf(d));

export function DocBadges({ doc }: { doc: DocRef }) {
  const warnings = doc.converted?.warnings ?? [];
  return (
    <>
      <Badge size="sm" {...statusWord(doc.status)} />
      <DocStage stage={stageOf(doc)} />
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
