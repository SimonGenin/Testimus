import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { Badge, jiraStatus } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { project } from "../../lib/data/client.ts";
import { read } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { FolderPanes, type PanesLayout } from "./list/FolderPanes.tsx";
import { KeyText, SYNC_OF, SYNC_TIP } from "./list/rows.tsx";
import { findFolder, flattenFolders, folderName } from "./list/tree.ts";

export { findFolder, folderName };

export const PAGE = 100;

export type JiraLayout = PanesLayout;

const styles = stylex.create({
  meta: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  count: { color: color.textMuted },
  end: { alignSelf: "center", paddingBlock: space.s2, color: color.textSubtle },
});

type Slice = { tests: RemoteTestRef[]; total: number };

// what is loading says so to a screen reader while it loads, and nothing once it is there
function Busy({ label, children }: { label: string | null; children: ReactNode }) {
  return label ? (
    <div role="status" aria-label={label}>
      {children}
    </div>
  ) : (
    children
  );
}

// ponytail: Jira's side of the list — two panes, each scrolling on its own, side by side or one above the other: the
// project's Xray folder tree, and the tests of the folder picked (slices of 100, the next asked when the end of the list
// shows) or of a Jira search; a test not pulled yet is pulled when opened
export function JiraTab({
  layout = "columns",
  tree,
  query,
  filter = "",
  folder,
  expanded,
  refs,
  activeId,
  pulling,
  busyFolders,
  onPickFolder,
  onOpenRemote,
  onPullFolder,
  onNew,
}: {
  /** the two panes side by side (folders left) or one above the other (folders on top) */
  layout?: JiraLayout;
  tree: Folder | null;
  query: string;
  filter?: string;
  folder: string;
  expanded: Set<string>;
  refs: LocalTestRef[];
  activeId: string;
  pulling: string[];
  busyFolders: string[];
  onPickFolder: (path: string) => void;
  onOpenRemote: (t: RemoteTestRef) => void;
  onPullFolder: (path: string) => void;
  onNew: () => void;
}) {
  const client = useQueryClient();
  const [list, setList] = useState<Slice>({ tests: [], total: 0 });
  const [loading, setLoading] = useState(true);
  // ponytail: what the accumulated list already holds — a ref, because the end of the list fires outside render, and
  // two calls must not ask for one slice twice
  const at = useRef({ key: "", page: 0, busy: false, total: 0 });
  const listKey = `${project() ?? ""}|${folder}|${query}`;
  const empty = !query && findFolder(tree, folder)?.testsCount === 0;
  // ponytail: a folder is listed once the tree says how many tests it holds directly — an empty one is never asked for
  const ready = !!query || !!tree;

  const loadSlice = (key: string, page: number) => {
    const a = at.current;
    if (a.key === key && (a.busy || (page > 0 && page * PAGE >= a.total))) return;
    at.current = { key, page, busy: true, total: page ? a.total : 0 };
    const mine = () => at.current.key === key && at.current.page === page;
    setLoading(true);
    const input = query ? { text: query } : { folder, page };
    read(client, "xray.search", input)
      .then((r) => {
        if (!mine()) return;
        const s = r as Slice | null;
        const tests = s?.tests ?? [];
        const total = query ? tests.length : (s?.total ?? tests.length);
        at.current.total = total;
        setList((prev) => (page ? { tests: [...prev.tests, ...tests], total } : { tests, total }));
      })
      .catch((e) => {
        if (!mine()) return;
        if (!page) setList({ tests: [], total: 0 });
        errorToast(e, query ? "Jira search failed" : `Could not list ${folderName(folder)}`);
        // ponytail: a slice that failed is asked for again the next time the end shows, not skipped
        at.current = { ...at.current, page: Math.max(0, page - 1), busy: false };
        setLoading(false);
      })
      .finally(() => {
        if (!mine()) return;
        at.current.busy = false;
        setLoading(false);
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names everything the list depends on
  useEffect(() => {
    setList({ tests: [], total: 0 });
    if (empty) {
      at.current = { key: listKey, page: 0, busy: false, total: 0 };
      setLoading(false);
      return;
    }
    setLoading(true);
    at.current = { key: "", page: 0, busy: false, total: 0 };
    if (!ready) return;
    // ponytail: the request itself waits — a search per keystroke would throw all but the last answer away
    const t = setTimeout(() => loadSlice(listKey, 0), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [listKey, empty, ready]);

  const needle = filter.toLowerCase();
  const rows = tree
    ? needle
      ? flattenFolders(tree, () => true).filter(
          (r) => r.folder.path !== "/" && r.folder.name.toLowerCase().includes(needle),
        )
      : flattenFolders(tree, (p) => expanded.has(p))
    : [];
  const shownTests = needle
    ? list.tests.filter((t) => t.summary.toLowerCase().includes(needle) || t.key.toLowerCase().includes(needle))
    : list.tests;
  const busy = loading && !list.tests.length;
  const filling = !query && list.tests.length > 0 && list.tests.length < list.total;
  const complete = !query && list.total > PAGE && list.tests.length >= list.total;
  const byKey = new Map(refs.filter((r) => r.key).map((r) => [r.key as string, r]));
  const open = shownTests.find((t) => byKey.get(t.key)?.id === activeId || t.key === activeId)?.key ?? null;
  const byTestKey = new Map(shownTests.map((t) => [t.key, t]));

  return (
    <FolderPanes
      name="jira"
      layout={layout}
      title={query ? `search “${query}”` : folderName(folder)}
      code={!(!query && folder === "/")}
      meta={
        ready && !busy
          ? query
            ? `${list.tests.length} found`
            : list.total
              ? `${list.tests.length} of ${list.total}`
              : "0"
          : null
      }
      folders={
        <Busy label={!tree ? "Loading folders" : null}>
          <List<(typeof rows)[number]>
            label="Jira folders"
            tree
            loading={!tree ? 5 : false}
            reading="xray.folders"
            items={rows}
            selected={query ? null : folder}
            getKey={(r) => r.folder.path}
            onSelect={onPickFolder}
            onToggle={onPickFolder}
            renderItem={({ folder: f, depth }) => ({
              title: f.path === "/" ? "Test Repository" : f.name,
              tooltip: needle ? f.path : undefined,
              depth: needle ? 0 : depth,
              expanded: f.folders.length && !needle ? expanded.has(f.path) : null,
              lead: (
                <Icon name={f.folders.length && !needle && expanded.has(f.path) ? "folder-open" : "folder"} size="sm" />
              ),
              trail: (
                <span
                  {...stylex.props(type.code, styles.count)}
                  title={`${f.testsCount} directly in this folder, ${f.totalCount} including sub-folders`}
                >
                  {f.testsCount === f.totalCount ? f.totalCount : `${f.testsCount}/${f.totalCount}`}
                </span>
              ),
              actions:
                f.totalCount > 0 ? (
                  <Button
                    variant="quiet"
                    size="xs"
                    iconOnly
                    icon="download"
                    label={`Pull every test of ${folderName(f.path)}`}
                    disabled={busyFolders.includes(f.path)}
                    onClick={() => onPullFolder(f.path)}
                  />
                ) : undefined,
            })}
          />
        </Busy>
      }
    >
      {ready && (
        <Busy label={busy ? (query ? `Searching Jira for ${query}` : `Loading tests in ${folderName(folder)}`) : null}>
          <List<RemoteTestRef>
            label={query ? `Jira tests found for ${query}` : `Jira tests in ${folderName(folder)}`}
            items={shownTests}
            loading={busy ? 6 : false}
            getKey={(t) => t.key}
            selected={open}
            density="two-line"
            onEndReached={
              !query && list.tests.length < list.total ? () => loadSlice(listKey, at.current.page + 1) : undefined
            }
            onSelect={(k) => {
              const t = byTestKey.get(k);
              if (t) onOpenRemote(t);
            }}
            empty={
              list.tests.length ? (
                <EmptyState icon="search" compact title={`No listed test matches “${filter}”.`} />
              ) : query ? (
                <EmptyState icon="search" compact title={`Nothing in Jira matches “${query}”.`} />
              ) : (
                <EmptyState
                  icon="folder"
                  compact
                  title="No tests in this folder"
                  text={`${folderName(folder)} is empty. Pick another folder, or create a test locally.`}
                  actions={<Button size="sm" icon="plus" label="New test" onClick={onNew} />}
                />
              )
            }
            renderItem={(t) => {
              const local = byKey.get(t.key);
              const busyRow = pulling.includes(t.key);
              return {
                title: t.summary,
                tooltip: local
                  ? t.summary
                  : busyRow
                    ? "Being pulled now"
                    : "Not pulled yet — opening it downloads it into the project",
                meta: (
                  <span {...stylex.props(styles.meta)}>
                    <KeyText text={t.key} />
                    {t.status && <Badge {...jiraStatus(t.status)} size="sm" />}
                    {local ? (
                      <Badge {...SYNC_OF[local.sync]} tooltip={SYNC_TIP[local.sync]} size="sm" />
                    ) : (
                      <Badge label={busyRow ? "Pulling…" : "Not pulled"} size="sm" busy={busyRow} />
                    )}
                  </span>
                ),
                trail: plural(t.stepCount, "step"),
              };
            }}
          />
        </Busy>
      )}
      {filling && (
        <div role="status" aria-label={`Loading more tests in ${folderName(folder)}`}>
          <Skeleton kind="row" />
        </div>
      )}
      {complete && <span {...stylex.props(type.small, styles.end)}>all {list.total} loaded</span>}
    </FolderPanes>
  );
}
