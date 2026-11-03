import type { Fit } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/index.ts";
import { FIT } from "./data.ts";

export const PROCESSOR_ONLY = "Made for a GPU: here it runs on the processor, several times slower.";

export function FitChip({ fit, processorOnly }: { fit: Fit | null; processorOnly?: boolean }) {
  if (!fit) return null;
  const l = FIT[fit.verdict];
  return (
    <>
      {processorOnly && (
        <Badge tone="warn" icon="warning" title={PROCESSOR_ONLY} small>
          Processor only
        </Badge>
      )}
      <Badge tone={l.tone} icon={l.icon} title={fit.message} small>
        {l.word}
      </Badge>
    </>
  );
}
