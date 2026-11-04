import type { LocalTestRef } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List } from "../../../components/ui/List.tsx";
import { TestMeta } from "./rows.tsx";
import type { Node } from "./tree.ts";

type Row = { kind: "folder"; node: Node; depth: number } | { kind: "test"; ref: LocalTestRef; depth: number };

const DIR = "dir:";

// ponytail: the project's local tests as a tree of their Xray folders — a folder folds, a test opens, a row's ✕ deletes
// the local copy
export function LocalTree({
  root,
  shut,
  forceOpen,
  activeId,
  onOpen,
  onToggle,
  onDelete,
}: {
  root: Node;
  shut: Set<string>;
  /** a filter is typed: every folder shows what matched */
  forceOpen: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onToggle: (path: string) => void;
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
              trail: <Badge label={String(r.node.total)} count size="sm" />,
            }
          : {
              title: r.ref.summary || "Untitled",
              tooltip: r.ref.summary || "Untitled",
              meta: <TestMeta r={r.ref} />,
              depth: r.depth,
              expanded: null,
              actions: (
                <Button
                  variant="quiet"
                  size="xs"
                  iconOnly
                  icon="close"
                  label={`Delete the local copy of ${r.ref.key ?? (r.ref.summary || r.ref.id)}`}
                  onClick={() => onDelete(r.ref)}
                />
              ),
            }
      }
    />
  );
}
