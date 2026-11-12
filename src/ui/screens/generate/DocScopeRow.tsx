import * as stylex from "@stylexjs/stylex";
import type { DocRef } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { plural } from "../../lib/format.ts";
import type { DocScope, Unready } from "../../lib/scope.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { indexWord } from "../documents/badges.tsx";
import { SectionTree } from "./SectionTree.tsx";

const styles = stylex.create({
  doc: {
    boxSizing: "border-box",
    borderBottomStyle: "solid",
    borderBottomWidth: { default: border.width, ":last-child": 0 },
    borderBottomColor: color.border,
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInlineEnd: space.s3,
  },
  flat: { paddingInlineStart: space.s4 },
  nested: { paddingInlineStart: space.s8 },
  grow: { flex: 1 },
  side: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.s1, flexShrink: 0 },
});

// ponytail: why a document cannot be picked yet — the line under its name, and the checkbox's reason
export const WHY: Record<Unready, { what: string; reason: string }> = {
  "not-converted": { what: "not converted yet", reason: "Not converted: convert it in Documents first" },
  converting: { what: "being converted · available once indexed", reason: "Being converted: wait until it is indexed" },
  indexing: { what: "being indexed · available when it is done", reason: "Being indexed: wait until it is done" },
  "not-indexed": { what: "not indexed · reindex to use it", reason: "Not indexed: reindex to use it" },
};

// ponytail: the same words as the Documents list (badges.tsx, « Indexing · 40 % » while an index run reads it), or
// « Converting… » while a conversion runs
function IndexBadge({ doc, why }: { doc: DocRef; why: Unready | null }) {
  if (why === "converting") return <Badge tone="info" busy size="sm" label="Converting…" />;
  return <Badge size="sm" {...indexWord(doc)} />;
}

// a document of the scope: ticked whole, left out, or narrowed to its sections (the tree under it)
export function DocScopeRow({
  doc: d,
  scope: s,
  why,
  nested,
  onChange,
}: {
  doc: DocRef;
  scope: DocScope;
  why: Unready | null;
  /** under its import folder's line */
  nested: boolean;
  onChange: (s: DocScope) => void;
}) {
  const some = Array.isArray(s);
  const total = d.converted?.stats?.sections;
  const what = why
    ? WHY[why].what
    : s === "all"
      ? `whole document${total ? ` · ${plural(total, "section")}` : ""}`
      : s === "none"
        ? "left out"
        : s.length
          ? `${plural(s.length, "section")} picked`
          : "no section picked yet";
  return (
    <li {...stylex.props(styles.doc)}>
      <div {...stylex.props(styles.row, nested ? styles.nested : styles.flat)}>
        <span {...stylex.props(styles.grow)}>
          <Checkbox
            checked={some ? "mixed" : s === "all"}
            disabled={why ? WHY[why].reason : false}
            label={d.title || d.code}
            hint={`${d.code} · ${what}`}
            onChange={(on) => onChange(on ? "all" : "none")}
          />
        </span>
        <span {...stylex.props(styles.side)}>
          <IndexBadge doc={d} why={why} />
          {why ? null : some ? (
            <Button size="sm" variant="quiet" label="Back to the whole document" onClick={() => onChange("all")} />
          ) : (
            <Button size="sm" variant="quiet" label="Only some sections…" onClick={() => onChange([])} />
          )}
        </span>
      </div>
      {some && <SectionTree docId={d.id} picked={s} onChange={(a) => onChange(a)} />}
    </li>
  );
}
