import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../../core/types.ts";
import type { ItemLink } from "../../../lib/fields.ts";
import { color, fontFamily, fontSize, space } from "../../../styles/tokens.stylex.ts";
import { StepSource } from "./StepSource.tsx";

const styles = stylex.create({
  links: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, paddingInline: space.s3 },
  group: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s1, minWidth: 0 },
  item: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.text },
});

// ponytail: the items of a column that links its items to their sources (a requirement code and the passage it comes
// from) — under the cell, each item with its sources; a source with no item is a plain source chip
export function ItemLinks({
  column,
  links,
  onOpen,
}: {
  column: string;
  links: ItemLink[];
  onOpen?: (s: Source) => void;
}) {
  return (
    <div data-column={column} {...stylex.props(styles.links)}>
      {links.map((l, i) =>
        l.item ? (
          <span key={i} {...stylex.props(styles.group)}>
            <span {...stylex.props(styles.item)}>{l.item}</span>
            {l.sources.map((s, k) => (
              <StepSource key={k} source={s} compact onOpen={onOpen} />
            ))}
          </span>
        ) : (
          l.sources.map((s, k) => <StepSource key={`${i}-${k}`} source={s} onOpen={onOpen} />)
        ),
      )}
    </div>
  );
}
