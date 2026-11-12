import type { ReactNode } from "react";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import type { Filed, Node } from "./tree.ts";

type Row<T extends Filed> =
  | { kind: "folder"; node: Node<T>; depth: number; fold: string }
  | { kind: "test"; ref: T; depth: number };

/** a tree under a head of its own (Review: the latest generation, then « Earlier ») */
export type TreeGroup<T extends Filed> = { label: string; meta?: string; root: Node<T> };

const DIR = "dir:";

// ponytail: tests as a tree of their folders — a folder folds, a test opens; how a test's row reads is the screen's
// (Tests: its key, states and trash; Generate: what Claude is doing with it; Review: what the check found), and a
// folder may say more than its count. Several trees under their heads fold apart: a folder's key is « <group>|<path> »
export function LocalTree<T extends Filed>({
  root,
  shut,
  forceOpen,
  activeId,
  label = "Local tests",
  getKey,
  renderTest,
  folderTrail,
  onOpen,
  onToggle,
}: {
  root: Node<T> | TreeGroup<T>[];
  /** the folders folded, by path (by « <group>|<path> » in groups) */
  shut: Set<string>;
  /** a filter is typed: every folder shows what matched */
  forceOpen: boolean;
  activeId: string;
  label?: string;
  getKey: (t: T) => string;
  renderTest: (t: T) => ListItemProps;
  /** what a folder's row says at its end: its count by default */
  folderTrail?: (n: Node<T>) => ReactNode;
  onOpen: (key: string) => void;
  onToggle: (fold: string) => void;
}) {
  const grouped = Array.isArray(root);
  const trees = grouped ? root : [{ label, root }];
  const rows: Row<T>[] = [];
  const keys: string[][] = trees.map(() => []);
  const keyOf = (r: Row<T>) => (r.kind === "folder" ? DIR + r.fold : getKey(r.ref));
  const isOpen = (fold: string) => forceOpen || !shut.has(fold);
  trees.forEach((g, gi) => {
    const walk = (n: Node<T>, depth: number) => {
      const fold = grouped ? `${gi}|${n.path}` : n.path;
      if (n.path !== "/") {
        const row: Row<T> = { kind: "folder", node: n, depth: depth - 1, fold };
        rows.push(row);
        keys[gi]?.push(keyOf(row));
      }
      if (!isOpen(fold)) return;
      for (const f of n.folders) walk(f, depth + 1);
      for (const r of n.tests) {
        const row: Row<T> = { kind: "test", ref: r, depth };
        rows.push(row);
        keys[gi]?.push(keyOf(row));
      }
    };
    walk(g.root, 0);
  });
  return (
    <List<Row<T>>
      label={label}
      tree
      items={rows}
      selected={activeId}
      {...(grouped ? { groups: trees.map((g, gi) => ({ label: g.label, meta: g.meta, keys: keys[gi] ?? [] })) } : {})}
      getKey={keyOf}
      onSelect={(k) => (k.startsWith(DIR) ? onToggle(k.slice(DIR.length)) : onOpen(k))}
      onToggle={(k) => k.startsWith(DIR) && onToggle(k.slice(DIR.length))}
      renderItem={(r) =>
        r.kind === "folder"
          ? {
              title: r.node.name,
              depth: r.depth,
              expanded: isOpen(r.fold),
              lead: <Icon name={isOpen(r.fold) ? "folder-open" : "folder"} size="sm" />,
              trail: folderTrail ? folderTrail(r.node) : String(r.node.total),
            }
          : { ...renderTest(r.ref), depth: r.depth }
      }
    />
  );
}
