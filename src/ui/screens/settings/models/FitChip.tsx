import type { Fit } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { FIT } from "./data.ts";

export const PROCESSOR_ONLY = "Made for a GPU: here it runs on the processor, several times slower.";

export function FitChip({ fit, processorOnly }: { fit: Fit | null; processorOnly?: boolean }) {
  if (!fit) return null;
  const l = FIT[fit.verdict];
  return (
    <>
      {processorOnly && (
        <Badge label="Processor only" tone="warning" icon="alert-triangle" size="sm" tooltip={PROCESSOR_ONLY} />
      )}
      <Badge label={l.word} tone={l.tone} icon={l.icon} size="sm" tooltip={fit.message} />
    </>
  );
}
