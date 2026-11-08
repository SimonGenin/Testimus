import * as stylex from "@stylexjs/stylex";
import { useContext } from "react";
import type { Source } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import { AppContext } from "../../lib/app.ts";
import { parseSourceRef, sourceLabel } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";

export type SkippedItem = { item: string; category?: string; why: string; sources?: string[] };

const OTHER = "Other";

const styles = stylex.create({
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minWidth: 0,
    paddingInlineStart: `calc(${space.s1} + ${size.iconSm} + ${space.s2})`,
  },
  group: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
  count: { color: color.textMuted },
  items: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s2 },
  item: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, color: color.text },
  line: { margin: 0, overflowWrap: "anywhere" },
  why: { color: color.textMuted },
  sources: { display: "flex", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
});

const ID = /^(?=.*[\d_])[\w.#-]+$/;

export type SkippedGroup = { category: string; items: SkippedItem[] };

// ponytail: the categories are Claude's own words for this generation — no list is known here; items of one category
// go together, the category with the most items first, then in the order Claude reported them
export function byCategory(skipped: SkippedItem[]): SkippedGroup[] {
  const groups: SkippedGroup[] = [];
  for (const s of skipped) {
    const category = s.category?.trim() || OTHER;
    const g = groups.find((x) => x.category === category);
    if (g) g.items.push(s);
    else groups.push({ category, items: [s] });
  }
  return groups
    .map((g, k) => ({ g, k }))
    .sort((a, b) => b.g.items.length - a.g.items.length || a.k - b.k)
    .map(({ g }) => g);
}

function Item({ s }: { s: SkippedItem }) {
  const openSource = useContext(AppContext)?.openSource;
  const observed = useObserved();
  const sources = (s.sources ?? []).map(parseSourceRef).filter((x): x is Source => !!x);
  return (
    <li {...stylex.props(styles.item)}>
      <p {...stylex.props(type.small, styles.line)}>
        <span {...stylex.props(ID.test(s.item) ? type.code : type.medium)}>{s.item}</span>
        {s.why && (
          <>
            <span {...stylex.props(styles.why)}> — </span>
            <span {...stylex.props(styles.why)}>{s.why}</span>
          </>
        )}
      </p>
      {sources.length > 0 && (
        <span {...stylex.props(styles.sources)}>
          {sources.map((x) => (
            <SourceChip
              key={`${x.docId}#${x.anchor} ${x.quote}`}
              reference={sourceLabel(x)}
              quote={x.quote || undefined}
              figure={isPictureAnchor(x.anchor)}
              observed={observed(x.docId)}
              onOpen={openSource && (() => openSource(x))}
            />
          ))}
        </span>
      )}
    </li>
  );
}

export function SkippedList({
  skipped,
  open,
  onOpenChange,
}: {
  skipped: SkippedItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Disclosure
      summary="Not written"
      count={skipped.length}
      countTone="warning"
      open={open}
      onOpenChange={onOpenChange}
    >
      <div {...stylex.props(styles.groups)}>
        {byCategory(skipped).map((g) => (
          <section key={g.category} aria-label={g.category} {...stylex.props(styles.group)}>
            <span {...stylex.props(styles.head)}>
              <Badge tone="warning" size="sm" label={g.category} />
              <span {...stylex.props(type.small, type.tabular, styles.count)}>{g.items.length}</span>
            </span>
            <ul {...stylex.props(styles.items)}>
              {g.items.map((s) => (
                <Item key={s.item} s={s} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Disclosure>
  );
}
