import * as stylex from "@stylexjs/stylex";
import type { LocalTestRef, SyncState } from "../../../../core/types.ts";
import { Badge, REVIEW, SYNC } from "../../../components/ui/Badge.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  meta: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  key: { color: color.textMuted },
  where: { color: color.textSubtle, marginInlineEnd: space.s1 },
});

export const SYNC_OF: Record<SyncState, (typeof SYNC)[keyof typeof SYNC]> = {
  local: SYNC.local,
  modified: SYNC.modified,
  synced: SYNC["in-sync"],
  "remote-changed": SYNC["changed-in-jira"],
};

export const SYNC_TIP: Record<SyncState, string> = {
  local: "Never pushed to Jira",
  modified: "Changed here since the last sync",
  synced: "Same as Jira at the last sync",
  "remote-changed": "Changed in Jira since your pull",
};

// ponytail: Tests shows a generated test only once validated, so « Validated » would be on nearly every row and says
// nothing; Draft and To fix still show (a test made by hand or pulled from Jira can be either)
export const shownReview = (review: string | undefined) =>
  review && review !== "validated" && review in REVIEW ? REVIEW[review as keyof typeof REVIEW] : undefined;

// the second line of a test row: its key, how it was made, its review state (unless validated) and its sync with Jira
export function TestMeta({ r }: { r: LocalTestRef }) {
  const review = shownReview(r.review);
  return (
    <span {...stylex.props(styles.meta)}>
      <span {...stylex.props(type.code, styles.key)}>{r.key ?? "no key"}</span>
      {r.generated && (
        <Badge
          label={r.edited ? "Generated · edited" : "Generated"}
          tone={r.edited ? "info" : "claude"}
          icon="claude"
          size="sm"
        />
      )}
      {review && <Badge {...review} size="sm" />}
      <Badge {...(SYNC_OF[r.sync] ?? SYNC.local)} tooltip={SYNC_TIP[r.sync]} size="sm" />
    </span>
  );
}

export function KeyText({ text }: { text: string }) {
  return <span {...stylex.props(type.code, styles.key)}>{text}</span>;
}

export function Where({ text }: { text: string }) {
  return <span {...stylex.props(styles.where)}>{text}</span>;
}
