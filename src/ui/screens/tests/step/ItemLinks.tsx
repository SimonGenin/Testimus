import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../../core/types.ts";
import { videoPreview } from "../../../components/sources/VideoPreview.tsx";
import { SourceChip } from "../../../components/ui/SourceChip.tsx";
import { type } from "../../../components/ui/type.ts";
import { type ItemLink, sourceLabel } from "../../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../../lib/media.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { StepSource } from "./StepSource.tsx";

const styles = stylex.create({
  links: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, paddingInline: space.s3 },
  group: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s1, minWidth: 0 },
  item: { color: color.text },
});

// ponytail: the items of a column that links its items to their sources (a requirement code and the passage it comes
// from) — under the cell: an item with one source is one chip that opens it, an item with several shows them after it;
// a source with no item is a plain source chip
export function ItemLinks({
  column,
  links,
  onOpen,
}: {
  column: string;
  links: ItemLink[];
  onOpen?: (s: Source) => void;
}) {
  const observed = useObserved();
  return (
    <div data-column={column} {...stylex.props(styles.links)}>
      {links.map((l, i) => {
        if (!l.item) return l.sources.map((s, k) => <StepSource key={`${i}-${k}`} source={s} onOpen={onOpen} />);
        if (l.sources.length === 1) {
          const s = l.sources[0];
          return (
            <SourceChip
              key={i}
              compact
              reference={`${l.item} · ${sourceLabel(s)}`}
              quote={s.quote || undefined}
              figure={isPictureAnchor(s.anchor)}
              observed={observed(s.docId)}
              preview={videoPreview(s)}
              onOpen={onOpen && (() => onOpen(s))}
            />
          );
        }
        return (
          <span key={i} {...stylex.props(styles.group)}>
            <span {...stylex.props(type.code, styles.item)}>{l.item}</span>
            {l.sources.map((s, k) => (
              <StepSource key={k} source={s} compact onOpen={onOpen} />
            ))}
          </span>
        );
      })}
    </div>
  );
}
