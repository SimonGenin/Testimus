import * as stylex from "@stylexjs/stylex";
import type { SearchKind, SearchMatch } from "../../../core/types.ts";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Badge, ReviewBadge } from "../ui/Badge.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import { Marked } from "./Marked.tsx";

export const KIND: Record<SearchKind, { label: string; one: string; icon: IconName }> = {
  test: { label: "Tests", one: "test", icon: "tests" },
  document: { label: "Documents", one: "document", icon: "documents" },
  passage: { label: "In the documents", one: "passage", icon: "section" },
};

const styles = stylex.create({
  where: { color: color.text, fontWeight: fontWeight.medium, marginInlineEnd: space.s3 },
  snippet: { fontFamily: fontFamily.reading },
  side: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  key: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
});

// ponytail: one search result as a row — its title with the words found, where they are, and what it is
export function hitRow(hit: SearchMatch): ListItemProps {
  const second =
    hit.snippet !== undefined ? (
      <>
        {hit.where && <span {...stylex.props(styles.where)}>{hit.where}</span>}
        <span {...stylex.props(hit.kind === "passage" && styles.snippet)}>
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
        {tag && <span {...stylex.props(styles.key)}>{tag}</span>}
      </span>
    ),
  };
}
