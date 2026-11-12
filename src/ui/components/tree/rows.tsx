import * as stylex from "@stylexjs/stylex";
import type { LocalTestRef, SyncState } from "../../../core/types.ts";
import { testLabel } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Badge, REVIEW, SYNC } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  meta: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  key: { color: color.textMuted },
  where: { color: color.textSubtle, marginInlineEnd: space.s1 },
  who: { display: "inline-flex", alignItems: "center", gap: space.s1, color: color.textSubtle },
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

// the second line of a test row: its key, how it was made, its review state (unless validated), its sync with Jira and
// who it is assigned to in Jira
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
      {r.assignee && (
        <span {...stylex.props(type.small, styles.who)}>
          <Avatar size="sm" name={r.assignee} id={r.assigneeId} />
          {r.assignee}
        </span>
      )}
    </span>
  );
}

export function KeyText({ text }: { text: string }) {
  return <span {...stylex.props(type.code, styles.key)}>{text}</span>;
}

export function Where({ text }: { text: string }) {
  return <span {...stylex.props(styles.where)}>{text}</span>;
}

// a local test's row, in the tree or in the tests pane: its summary, its key and states, its trash
export const testItem = (
  r: LocalTestRef,
  locked: ((id: string) => false | string) | undefined,
  onDelete: (r: LocalTestRef) => void,
): ListItemProps => ({
  title: testLabel(r),
  tooltip: testLabel(r),
  meta: <TestMeta r={r} />,
  actions: (
    <Button
      variant="quiet"
      size="xs"
      iconOnly
      icon="trash"
      label={`Delete the local copy of ${r.key ?? testLabel(r)}`}
      disabled={locked?.(r.id) ?? false}
      onClick={() => onDelete(r)}
    />
  ),
});
