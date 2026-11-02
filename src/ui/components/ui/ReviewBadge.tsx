import type { Review } from "../../../core/types.ts";
import { Badge, type BadgeTone } from "./Badge.tsx";
import type { IconName } from "./Icon.tsx";

export const REVIEW: Record<Review, { label: string; tone: BadgeTone; icon: IconName }> = {
  draft: { label: "Draft", tone: "neutral", icon: "draft" },
  checked: { label: "Checked", tone: "info", icon: "checked" },
  "to-fix": { label: "To fix", tone: "warn", icon: "edit" },
  validated: { label: "Validated", tone: "ok", icon: "validated" },
};

export function ReviewBadge({ review, small, suffix }: { review: Review; small?: boolean; suffix?: string }) {
  const r = REVIEW[review] ?? REVIEW.draft;
  return (
    <Badge tone={r.tone} icon={r.icon} small={small}>
      {r.label}
      {suffix}
    </Badge>
  );
}
