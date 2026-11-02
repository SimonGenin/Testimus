import type { SyncState } from "../../../core/types.ts";
import { Badge, type BadgeTone } from "./Badge.tsx";
import type { IconName } from "./Icon.tsx";

export const SYNC: Record<SyncState, { label: string; tone: BadgeTone; icon: IconName; title: string }> = {
  local: { label: "Local only", tone: "line", icon: "local", title: "Never pushed to Jira" },
  modified: { label: "Modified", tone: "line", icon: "modified", title: "Changed here since the last sync" },
  synced: { label: "Up to date", tone: "line", icon: "synced", title: "Same as Jira at the last sync" },
  "remote-changed": {
    label: "Changed in Jira",
    tone: "warn",
    icon: "changed",
    title: "Changed in Jira since your pull",
  },
};

export function SyncBadge({ sync, small }: { sync: SyncState; small?: boolean }) {
  const s = SYNC[sync] ?? SYNC.local;
  return (
    <Badge tone={s.tone} icon={s.icon} small={small} title={s.title}>
      {s.label}
    </Badge>
  );
}
