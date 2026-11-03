import type { Source } from "../../../../core/types.ts";
import { SourceChip } from "../../../components/ui/SourceChip.tsx";
import { sourceLabel } from "../../../lib/fields.ts";

// a step's claim and where it comes from: docId and anchor in the mono face, the quote in the reading face
export function StepSource({
  source,
  compact,
  pressed,
  onOpen,
}: {
  source: Source;
  compact?: boolean;
  pressed?: boolean;
  onOpen?: (s: Source) => void;
}) {
  return (
    <SourceChip
      reference={sourceLabel(source)}
      quote={source.quote || undefined}
      figure={source.anchor.startsWith("fig:")}
      compact={compact}
      pressed={pressed}
      onOpen={onOpen && (() => onOpen(source))}
    />
  );
}
