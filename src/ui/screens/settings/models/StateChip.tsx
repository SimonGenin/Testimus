import { Badge } from "../../../components/ui/index.ts";
import { type ModelState, STATE } from "./data.ts";

export function StateChip({ state }: { state: ModelState }) {
  const l = STATE[state];
  return (
    <Badge tone={l.tone} icon={l.icon} small>
      {l.word}
    </Badge>
  );
}
