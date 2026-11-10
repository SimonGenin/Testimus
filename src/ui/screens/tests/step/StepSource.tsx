import type { Source } from "../../../../core/types.ts";
import { videoPreview } from "../../../components/sources/VideoPreview.tsx";
import { SourceChip } from "../../../components/ui/SourceChip.tsx";
import { sourceLabel } from "../../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../../lib/media.ts";

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
  const observed = useObserved();
  return (
    <SourceChip
      reference={sourceLabel(source)}
      quote={source.quote || undefined}
      figure={isPictureAnchor(source.anchor)}
      observed={observed(source.docId)}
      preview={videoPreview(source)}
      compact={compact}
      pressed={pressed}
      onOpen={onOpen && (() => onOpen(source))}
    />
  );
}
