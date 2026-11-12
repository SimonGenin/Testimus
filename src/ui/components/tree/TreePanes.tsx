import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color } from "../../styles/tokens.stylex.ts";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";
import { type } from "../ui/type.ts";
import { FolderPanes, type PanesLayout } from "./FolderPanes.tsx";
import { type Filed, folderName, type Node } from "./tree.ts";

const styles = stylex.create({
  count: { color: color.textMuted },
});

type Row<T extends Filed> = { node: Node<T>; depth: number };

export const findNode = <T extends Filed>(n: Node<T>, path: string): Node<T> | null => {
  if (n.path === path) return n;
  for (const c of n.folders) {
    const hit = findNode(c, path);
    if (hit) return hit;
  }
  return null;
};

// ponytail: tests as Jira's side shows its own — the folders the tests sit in, and the tests directly in the folder
// picked; a folder that is gone (its last test moved or deleted) leaves the root picked. How a test's row reads is the
// screen's (Tests: its key, states and trash; Review: what the check found), and the tests pane may group its rows
export function TreePanes<T extends Filed>({
  name,
  label,
  layout,
  root,
  folder,
  shut,
  activeId,
  getKey,
  renderTest,
  groups,
  empty,
  onPickFolder,
  onToggle,
  onOpen,
}: {
  name: "local" | "review";
  /** whose tests (« Local »): the lists are « <label> folders » and « <label> tests in <folder> » */
  label: string;
  layout: PanesLayout;
  root: Node<T>;
  folder: string;
  shut: Set<string>;
  activeId: string;
  getKey: (t: T) => string;
  renderTest: (t: T) => ListItemProps;
  /** heads over the tests of the folder picked (Review: the latest generation, then « Earlier ») */
  groups?: (tests: T[]) => { label: string; meta?: string; keys: string[] }[] | undefined;
  /** the folder picked holds no test directly: its count under its sub-folders */
  empty: (picked: Node<T>) => ReactNode;
  onPickFolder: (path: string) => void;
  onToggle: (path: string) => void;
  onOpen: (key: string) => void;
}) {
  const picked = findNode(root, folder) ?? root;
  const rows: Row<T>[] = [];
  const walk = (n: Node<T>, depth: number) => {
    rows.push({ node: n, depth });
    if (n.path === "/" || !shut.has(n.path)) for (const f of n.folders) walk(f, depth + 1);
  };
  walk(root, 0);
  const tests = picked.tests;
  const heads = groups?.(tests);
  return (
    <FolderPanes
      name={name}
      layout={layout}
      title={folderName(picked.path)}
      code={picked.path !== "/"}
      meta={String(tests.length)}
      folders={
        <List<Row<T>>
          label={`${label} folders`}
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
      <List<T>
        label={`${label} tests in ${folderName(picked.path)}`}
        items={tests}
        {...(heads ? { groups: heads } : {})}
        getKey={getKey}
        selected={activeId}
        density="two-line"
        onSelect={onOpen}
        empty={empty(picked)}
        renderItem={renderTest}
      />
    </FolderPanes>
  );
}
