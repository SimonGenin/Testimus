import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { type } from "../ui/type.ts";

export type CheckNode = {
  key: string;
  label: string;
  /** a branch (a folder): ticking it ticks every leaf under it */
  children?: CheckNode[];
  /** on the right of a leaf: its key, its state */
  meta?: ReactNode;
};

const styles = stylex.create({
  tree: {
    boxSizing: "border-box",
    listStyle: "none",
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s2,
    display: "flex",
    flexDirection: "column",
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.row,
    minWidth: 0,
  },
  twisty: { width: size.controlSm, flexShrink: 0, display: "inline-flex" },
  label: { flex: 1, minWidth: 0 },
  meta: { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: space.s2, color: color.textSubtle },
});

const leaves = (n: CheckNode): string[] => (n.children ? n.children.flatMap(leaves) : [n.key]);

// ponytail: a tree to pick leaves from, a branch ticking all its leaves at once (mixed while some are) — the shape of
// Generate's section picker, for any tree whose leaves are what is picked (New run's tests by folder)
export function CheckTree({
  label,
  nodes,
  picked,
  onPick,
}: {
  label: string;
  nodes: CheckNode[];
  picked: ReadonlySet<string>;
  /** the leaves to tick (on) or untick */
  onPick: (keys: string[], on: boolean) => void;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const fold = (key: string) =>
    setFolded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const rows: ReactNode[] = [];
  const walk = (list: CheckNode[], depth: number) => {
    for (const n of list) {
      const indent = { paddingInlineStart: `calc(${space.s6} * ${depth})` };
      if (!n.children) {
        rows.push(
          <li key={n.key} {...stylex.props(styles.row)} style={indent}>
            <span {...stylex.props(styles.twisty)} />
            <span {...stylex.props(styles.label)}>
              <Checkbox checked={picked.has(n.key)} label={n.label} onChange={(on) => onPick([n.key], on)} />
            </span>
            {n.meta && <span {...stylex.props(type.small, styles.meta)}>{n.meta}</span>}
          </li>,
        );
        continue;
      }
      const all = leaves(n);
      const on = all.filter((k) => picked.has(k)).length;
      const open = !folded.has(n.key);
      rows.push(
        <li key={n.key} {...stylex.props(styles.row)} style={indent}>
          <span {...stylex.props(styles.twisty)}>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={open ? "chevron-down" : "chevron-right"}
              label={`${open ? "Fold" : "Unfold"} ${n.label}`}
              expanded={open}
              onClick={() => fold(n.key)}
            />
          </span>
          <span {...stylex.props(styles.label)}>
            <Checkbox
              icon="folder"
              checked={on === 0 ? false : on === all.length ? true : "mixed"}
              label={n.label}
              onChange={() => onPick(all, on < all.length)}
            />
          </span>
          <span {...stylex.props(type.small, styles.meta)}>
            {on} of {all.length}
          </span>
        </li>,
      );
      if (open) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return (
    <ul aria-label={label} {...stylex.props(styles.tree)}>
      {rows}
    </ul>
  );
}
