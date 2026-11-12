import type { ReactNode } from "react";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import type { Filed, Node } from "./tree.ts";

type Row<T extends Filed> = { kind: "folder"; node: Node<T>; depth: number } | { kind: "test"; ref: T; depth: number };

const DIR = "dir:";

// ponytail: tests as a tree of their folders — a folder folds, a test opens; how a test's row reads is the screen's
// (Tests: its key, states and trash; Generate: what Claude is doing with it), and a folder may say more than its count
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
  root: Node<T>;
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
  onToggle: (path: string) => void;
}) {
  const rows: Row<T>[] = [];
  const walk = (n: Node<T>, depth: number) => {
    const open = forceOpen || !shut.has(n.path);
    if (n.path !== "/") rows.push({ kind: "folder", node: n, depth: depth - 1 });
    if (!open) return;
    for (const f of n.folders) walk(f, depth + 1);
    for (const r of n.tests) rows.push({ kind: "test", ref: r, depth });
  };
  walk(root, 0);
  return (
    <List<Row<T>>
      label={label}
      tree
      items={rows}
      selected={activeId}
      getKey={(r) => (r.kind === "folder" ? DIR + r.node.path : getKey(r.ref))}
      onSelect={(k) => (k.startsWith(DIR) ? onToggle(k.slice(DIR.length)) : onOpen(k))}
      onToggle={(k) => k.startsWith(DIR) && onToggle(k.slice(DIR.length))}
      renderItem={(r) =>
        r.kind === "folder"
          ? {
              title: r.node.name,
              depth: r.depth,
              expanded: forceOpen || !shut.has(r.node.path),
              lead: <Icon name={forceOpen || !shut.has(r.node.path) ? "folder-open" : "folder"} size="sm" />,
              trail: folderTrail ? folderTrail(r.node) : String(r.node.total),
            }
          : { ...renderTest(r.ref), depth: r.depth }
      }
    />
  );
}
