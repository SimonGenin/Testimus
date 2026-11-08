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

export type SkippedItem = { item: string; category: string; why: string; sources?: string[] };

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

type Group = { category: string; items: SkippedItem[] };

// ponytail: the core sends the items grouped by Claude's categories, the largest first (gen-reply.ts byCategory); the
// page only cuts the list where the category changes
function cut(skipped: SkippedItem[]): Group[] {
  const groups: Group[] = [];
  for (const s of skipped) {
    const last = groups.at(-1);
    if (last && last.category === s.category) last.items.push(s);
    else groups.push({ category: s.category, items: [s] });
  }
  return groups;
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
        {cut(skipped).map((g, k) => (
          <section key={`${k}:${g.category}`} aria-label={g.category} {...stylex.props(styles.group)}>
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
