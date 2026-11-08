import * as stylex from "@stylexjs/stylex";
import { useContext, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { AppContext } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { flip, parents, type TocEntry, tick } from "../../lib/scope.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  tree: {
    boxSizing: "border-box",
    listStyle: "none",
    margin: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: space.s3,
    paddingInline: space.s3,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
  row: { boxSizing: "border-box", display: "flex", alignItems: "center", gap: space.s2, minHeight: size.row },
  twisty: { width: size.controlSm, flexShrink: 0 },
  label: { flex: 1, minWidth: 0 },
  empty: { margin: 0, padding: space.s3, color: color.textSubtle },
});

const number = (a: string) => (/^§\d+(\.\d+)*$/.test(a) ? a.slice(1) : "");

export function SectionTree({
  docId,
  picked,
  onChange,
}: {
  docId: string;
  picked: string[];
  onChange: (anchors: string[]) => void;
}) {
  const r = useRead("docs.show", { id: docId, brief: true });
  const openSource = useContext(AppContext)?.openSource;
  const toc = r.isPending ? null : ((r.data as { toc?: TocEntry[] } | null)?.toc ?? []);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const up = useMemo(() => (toc ? parents(toc) : []), [toc]);

  if (!toc)
    return (
      <div aria-busy="true" {...stylex.props(styles.tree)}>
        <Skeleton lines={2} />
        <Loading read="docs.show" />
      </div>
    );
  if (!toc.length)
    return <p {...stylex.props(type.compact, styles.empty)}>This document has no headings to pick from.</p>;

  const hasKids = (i: number) => up.some((p) => p === i);
  const shown = (i: number) => {
    for (let p = up[i]; p >= 0; p = up[p]) if (!open.has(p)) return false;
    return true;
  };
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const base = Math.min(...toc.map((t) => t.level));
  return (
    <ul aria-label="Sections" {...stylex.props(styles.tree)}>
      {toc.map((t, i) => {
        if (!shown(i)) return null;
        const state = tick(toc, up, picked, i);
        const n = number(t.anchor);
        return (
          <li
            key={t.anchor}
            {...stylex.props(styles.row)}
            style={{ paddingInlineStart: `calc(${space.s6} * ${t.level - base})` }}
          >
            <span {...stylex.props(styles.twisty)}>
              {hasKids(i) && (
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={open.has(i) ? "chevron-down" : "chevron-right"}
                  label={`${open.has(i) ? "Fold" : "Unfold"} ${t.title}`}
                  expanded={open.has(i)}
                  onClick={() => toggle(i)}
                />
              )}
            </span>
            <span {...stylex.props(styles.label)}>
              <Checkbox
                checked={state === "on" ? true : state === "mixed" ? "mixed" : false}
                label={n ? `${n} ${t.title}` : t.title}
                onChange={() => onChange(flip(toc, up, picked, i))}
              />
            </span>
            {openSource && (
              <Button
                variant="quiet"
                size="sm"
                iconOnly
                icon="eye"
                label="Text"
                onClick={() => openSource({ docId, anchor: t.anchor, quote: "" })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
