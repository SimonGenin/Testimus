import * as stylex from "@stylexjs/stylex";
import type { SearchKind, SearchMatch } from "../../../core/types.ts";
import { color, fontFamily, space } from "../../styles/tokens.stylex.ts";
import { Badge, ReviewBadge } from "../ui/Badge.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import { Marked } from "../ui/Marked.tsx";
import { type } from "../ui/type.ts";

export const KIND: Record<SearchKind, { label: string; one: string; icon: IconName }> = {
  test: { label: "Tests", one: "test", icon: "tests" },
  document: { label: "Documents", one: "document", icon: "file" },
  passage: { label: "In the documents", one: "passage", icon: "section" },
};

const styles = stylex.create({
  where: { flex: "none", color: color.textMuted, marginInlineEnd: space.s3 },
  cut: { flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  snippet: { fontFamily: fontFamily.reading },
  side: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  key: { color: color.textMuted, whiteSpace: "nowrap" },
});

// ponytail: one search result as a row — its title with the words found, where they are (one line, cut with an
// ellipsis), and what it is
export function hitRow(hit: SearchMatch): ListItemProps {
  const second =
    hit.snippet !== undefined ? (
      <>
        {hit.where && <span {...stylex.props(type.medium, styles.where)}>{hit.where}</span>}
        <span {...stylex.props(styles.cut, hit.kind === "passage" && styles.snippet)}>
          <Marked text={hit.snippet} marks={hit.marks} />
        </span>
      </>
    ) : hit.kind === "test" ? (
      hit.detail?.split(" · ").slice(1).join(" · ") || undefined
    ) : (
      hit.detail || undefined
    );
  const tag = hit.kind === "test" ? (hit.key ?? "local") : hit.kind === "document" ? "" : hit.docId;
  return {
    lead: <Icon name={KIND[hit.kind].icon} />,
    title: <Marked text={hit.title} marks={hit.titleMarks} />,
    meta: second,
    trail: (
      <span {...stylex.props(styles.side)}>
        {hit.why === "meaning" && (
          <Badge label="≈ meaning" tone="info" size="sm" tooltip="Found by its meaning, not by its words" />
        )}
        {hit.review && <ReviewBadge state={hit.review} size="sm" />}
        {tag && <span {...stylex.props(type.code, styles.key)}>{tag}</span>}
      </span>
    ),
  };
}
