import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { type } from "../../components/ui/type.ts";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { testName } from "../../lib/labels.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { needsLook, SkippedEntry, type SkippedItem } from "./SkippedEntry.tsx";

export type { SkippedItem } from "./SkippedEntry.tsx";

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
  items: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s3 },
});

type Group = { category: string; items: SkippedItem[] };

// ponytail: the core sends the items grouped by their reason, the largest group first (gen-reply.ts byCategory); the
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

// ponytail: a reason that takes no coverage away (nothing to see, tested elsewhere, not asked) is a neutral head; the
// others are gaps someone can close, in the warning tone
const NO_GAP: NonNullable<SkippedItem["reason"]>[] = ["not-observable", "already-tested", "out-of-scope"];

// ponytail: what a generation left without a test, by reason — the items that need a look (a doubt, a second look that
// found the passage) are counted beside the summary, so the fold says whether it must be opened
export function SkippedList({
  skipped,
  open,
  onOpenChange,
}: {
  skipped: SkippedItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const named = skipped.some((s) => !!s.test || !!s.doubts?.length || !!s.review);
  const tests = useRead("tests.list", { generating: true }, { optional: true, enabled: named && !!project() }).data;
  const nameOf = (id: string) => {
    const t = tests?.find((x) => x.id === id);
    return t && testName(t, id);
  };
  const look = skipped.filter(needsLook).length;
  return (
    <Disclosure
      summary="Not written"
      count={skipped.length}
      countTone="warning"
      meta={look > 0 && <Badge size="sm" tone="warning" icon="alert-triangle" label={`${look} to look at`} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div {...stylex.props(styles.groups)}>
        {cut(skipped).map((g, k) => (
          <section key={`${k}:${g.category}`} aria-label={g.category} {...stylex.props(styles.group)}>
            <span {...stylex.props(styles.head)}>
              <Badge
                tone={g.items.every((s) => s.reason && NO_GAP.includes(s.reason)) ? "neutral" : "warning"}
                size="sm"
                label={g.category}
              />
              <span {...stylex.props(type.small, type.tabular, styles.count)}>{g.items.length}</span>
            </span>
            <ul {...stylex.props(styles.items)}>
              {g.items.map((s) => (
                <SkippedEntry key={s.item} s={s} nameOf={nameOf} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Disclosure>
  );
}
