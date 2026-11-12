import * as stylex from "@stylexjs/stylex";
import type { LocalTestRef } from "../../../../core/types.ts";
import { FolderPanes, type PanesLayout } from "../../../components/tree/FolderPanes.tsx";
import { testItem } from "../../../components/tree/rows.tsx";
import { folderName, type Node } from "../../../components/tree/tree.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List } from "../../../components/ui/List.tsx";
import { type } from "../../../components/ui/type.ts";
import { plural } from "../../../lib/format.ts";
import { color } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  count: { color: color.textMuted },
});

type Row = { node: Node; depth: number };

const findNode = (n: Node, path: string): Node | null => {
  if (n.path === path) return n;
  for (const c of n.folders) {
    const hit = findNode(c, path);
    if (hit) return hit;
  }
  return null;
};

// ponytail: the local tests as Jira's side shows its own — the folders the tests sit in, and the tests directly in the
// folder picked; a folder that is gone (its last test moved or deleted) leaves the root picked
export function LocalPanes({
  layout,
  root,
  folder,
  shut,
  activeId,
  onPickFolder,
  onToggle,
  onOpen,
  locked,
  onDelete,
  onNew,
}: {
  layout: PanesLayout;
  root: Node;
  folder: string;
  shut: Set<string>;
  activeId: string;
  onPickFolder: (path: string) => void;
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
  /** why a test's row cannot be deleted now (Claude's lock), or false */
  locked?: (id: string) => false | string;
  onDelete: (r: LocalTestRef) => void;
  onNew: () => void;
}) {
  const picked = findNode(root, folder) ?? root;
  const rows: Row[] = [];
  const walk = (n: Node, depth: number) => {
    rows.push({ node: n, depth });
    if (n.path === "/" || !shut.has(n.path)) for (const f of n.folders) walk(f, depth + 1);
  };
  walk(root, 0);
  const tests = picked.tests;
  return (
    <FolderPanes
      name="local"
      layout={layout}
      title={folderName(picked.path)}
      code={picked.path !== "/"}
      meta={String(tests.length)}
      folders={
        <List<Row>
          label="Local folders"
          tree
          items={rows}
          selected={picked.path}
          getKey={(r) => r.node.path}
          onSelect={onPickFolder}
          onToggle={onToggle}
          renderItem={({ node: n, depth }) => {
            const open = n.path === "/" || !shut.has(n.path);
            return {
              title: n.path === "/" ? "Test Repository" : n.name,
              depth,
              expanded: n.folders.length && n.path !== "/" ? open : null,
              lead: <Icon name={n.folders.length && open ? "folder-open" : "folder"} size="sm" />,
              trail: (
                <span
                  {...stylex.props(type.code, styles.count)}
                  title={`${n.tests.length} directly in this folder, ${n.total} including sub-folders`}
                >
                  {n.tests.length === n.total ? n.total : `${n.tests.length}/${n.total}`}
                </span>
              ),
            };
          }}
        />
      }
    >
      <List<LocalTestRef>
        label={`Local tests in ${folderName(picked.path)}`}
        items={tests}
        getKey={(r) => r.id}
        selected={activeId}
        density="two-line"
        onSelect={onOpen}
        empty={
          <EmptyState
            icon="folder"
            compact
            title="No test directly in this folder"
            text={`${plural(picked.total, "test")} in its sub-folders.`}
            actions={<Button size="sm" icon="plus" label="New test" onClick={onNew} />}
          />
        }
        renderItem={(r) => testItem(r, locked, onDelete)}
      />
    </FolderPanes>
  );
}
