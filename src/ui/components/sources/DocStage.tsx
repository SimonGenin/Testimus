import type { DocStage as Stage } from "../../../core/types.ts";
import { stageWord } from "../../lib/stage.ts";
import { Badge } from "../ui/Badge.tsx";

// ponytail: where a document is (docs.list's stage) — the one way it is shown: the documents list, the job panel of a
// conversion, Generate's picker; its status (draft, submitted, validated) is another badge
export function DocStage({ stage, size = "sm" }: { stage: Stage; size?: "sm" | "md" }) {
  return <Badge size={size} {...stageWord(stage)} />;
}
