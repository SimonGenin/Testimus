import type { Fit } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/index.ts";
import { FIT } from "./data.ts";

export function FitChip({ fit }: { fit: Fit | null }) {
  if (!fit) return null;
  const l = FIT[fit.verdict];
  return (
    <Badge tone={l.tone} icon={l.icon} title={fit.message} small>
      {l.word}
    </Badge>
  );
}
