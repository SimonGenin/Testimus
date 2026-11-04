import { Badge } from "../../../components/ui/Badge.tsx";
import { type ModelState, STATE } from "./data.ts";

export function StateChip({ state }: { state: ModelState }) {
  const l = STATE[state];
  return <Badge label={l.word} tone={l.tone} icon={l.icon} size="sm" />;
}
