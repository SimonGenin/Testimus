import type { LocalTestRef } from "../../../../core/types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List } from "../../../components/ui/List.tsx";
import type { ListItemProps } from "../../../components/ui/ListItem.tsx";
import { TestMeta } from "./rows.tsx";
import type { Node } from "./tree.ts";

type Row = { kind: "folder"; node: Node; depth: number } | { kind: "test"; ref: LocalTestRef; depth: number };

const DIR = "dir:";

// ponytail: the project's local tests as a tree of their Xray folders — a folder folds, a test opens, a row's trash
// deletes the local copy (disabled while Claude works on that test)
export function LocalTree({
  root,
  shut,
  forceOpen,
  activeId,
  onOpen,
  onToggle,
  locked,
  onDelete,
}: {
  root: Node;
  shut: Set<string>;
  /** a filter is typed: every folder shows what matched */
  forceOpen: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onToggle: (path: string) => void;
  /** why a test's row cannot be deleted now (Claude's lock), or false */
  locked?: (id: string) => false | string;
  onDelete: (r: LocalTestRef) => void;
}) {
  const rows: Row[] = [];
  const walk = (n: Node, depth: number) => {
    const open = forceOpen || !shut.has(n.path);
    if (n.path !== "/") rows.push({ kind: "folder", node: n, depth: depth - 1 });
    if (!open) return;
    for (const f of n.folders) walk(f, depth + 1);
    for (const r of n.tests) rows.push({ kind: "test", ref: r, depth });
  };
  walk(root, 0);
  return (
    <List<Row>
      label="Local tests"
      tree
      items={rows}
      selected={activeId}
      getKey={(r) => (r.kind === "folder" ? DIR + r.node.path : r.ref.id)}
      onSelect={(k) => (k.startsWith(DIR) ? onToggle(k.slice(DIR.length)) : onOpen(k))}
      onToggle={(k) => k.startsWith(DIR) && onToggle(k.slice(DIR.length))}
      renderItem={(r) =>
        r.kind === "folder"
          ? {
              title: r.node.name,
              depth: r.depth,
              expanded: forceOpen || !shut.has(r.node.path),
              lead: <Icon name={forceOpen || !shut.has(r.node.path) ? "folder-open" : "folder"} size="sm" />,
              trail: String(r.node.total),
            }
          : { ...testItem(r.ref, locked, onDelete), depth: r.depth }
      }
    />
  );
}

// a local test's row, in the tree or in the tests pane: its summary, its key and states, its trash
export const testItem = (
  r: LocalTestRef,
  locked: ((id: string) => false | string) | undefined,
  onDelete: (r: LocalTestRef) => void,
): ListItemProps => ({
  title: r.summary || "Untitled",
  tooltip: r.summary || "Untitled",
  meta: <TestMeta r={r} />,
  actions: (
    <Button
      variant="quiet"
      size="xs"
      iconOnly
      icon="trash"
      label={`Delete the local copy of ${r.key ?? (r.summary || r.id)}`}
      disabled={locked?.(r.id) ?? false}
      onClick={() => onDelete(r)}
    />
  ),
});
