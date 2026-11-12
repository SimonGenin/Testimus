import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { LocalTree } from "../../components/tree/LocalTree.tsx";
import { testItem } from "../../components/tree/rows.tsx";
import { ancestors, isKeyQuery, type Listed, localTree, matches } from "../../components/tree/tree.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { project, run } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { usePref } from "../../lib/prefs.ts";
import { jumpTo, useSearch } from "../../lib/search.ts";
import { errorToast, jobToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type DeleteTarget, DeleteTest, deleteTarget, deleteTest, needsAsking } from "./DeleteTest.tsx";
import { JiraConnect, useDisconnect } from "./JiraConnect.tsx";
import { type JiraLayout, JiraTab } from "./JiraTab.tsx";
import { assigneesOf } from "./list/assignee.ts";
import { FoundList } from "./list/FoundList.tsx";
import { type ListLayout, ListTools } from "./list/ListTools.tsx";
import { LocalPanes } from "./list/LocalPanes.tsx";
import { useNewTest } from "./list/newTest.ts";
import { useListView } from "./list/useListView.ts";
import { claudeLock } from "./lock.ts";
import { useReplaceWithJira } from "./replace.tsx";
import { TestsTabs } from "./TestsTabs.tsx";
import { cloneTest } from "./testActions.ts";

export { isKeyQuery, localTree };

const styles = stylex.create({
  side: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", backgroundColor: color.surface },
  head: { flex: "none" },
  grow: { flex: 1 },
  note: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    color: color.textMuted,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: space.s2,
  },
  panes: { overflow: "hidden" },
  waiting: { paddingInline: space.s3 },
  conn: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingTop: space.s3,
    paddingInline: space.s5,
    color: color.textMuted,
  },
});

type PullResult = {
  pulled: string[];
  skipped: { key: string; reason: string }[];
  failed: { key: string; error: string }[];
};

// ponytail: the left side of Tests — the local tests (tree or what the filter found) and Jira's tests (folders, slices,
// search); creating, cloning, pulling and deleting from here
export function TestList({
  refs,
  loading,
  activeId,
  onOpen,
  onReload,
  pulling = [],
  onPull,
  onDeleted,
}: {
  refs: LocalTestRef[];
  loading: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onReload: () => Promise<unknown>;
  pulling?: string[];
  onPull?: (key: string, summary: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const app = useApp();
  const client = useQueryClient();
  const p = app.info?.project;
  const jiraOn = !!p?.jiraProject && !p.jiraOffline;
  // ponytail: what the Jira side was loaded for — a new key, a reconnect or a disconnect starts it again
  const jiraFor = jiraOn ? `${app.info?.dir}|${p.jiraProject}` : "";
  const v = useListView();
  const [kept, setLayout] = usePref("jiraLayout");
  const layout = kept as JiraLayout;
  const treeQ = useRead("xray.folders", {}, { enabled: jiraOn });
  const tree = jiraOn ? ((treeQ.data as Folder | undefined) ?? null) : null;
  const treeError = jiraOn && treeQ.error ? message(treeQ.error) : "";
  // ponytail: Jira's folders and tests scroll in their own panes, so the list's body does not scroll around them
  const jiraPanes = v.tab === "jira" && jiraOn && !treeError;
  const [localPref, setLocalLayout] = usePref("localLayout");
  const localKept = localPref as ListLayout;
  const [busy, setBusy] = useState<string[]>([]);
  const [doomed, setDoomed] = useState<DeleteTarget | null>(null);
  const replacing = useReplaceWithJira({ onReplaced: () => void onReload() });
  const disconnect = useDisconnect();
  const active = refs.find((r) => r.id === activeId);
  const query = v.search.trim();
  const needle = v.filter.trim();

  const listed = useMemo(() => refs.filter((r) => !(r as Listed).awaiting), [refs]);
  const waiting = refs.length - listed.length;
  const assignees = useMemo(() => assigneesOf(listed), [listed]);
  // ponytail: the local tests in two panes as Jira's are, once there are some and no filter is typed (what a filter
  // finds is one list, across the folders)
  const localPanes = v.tab === "local" && localKept !== "tree" && !!project() && listed.length > 0 && !needle;
  const shown = useMemo(() => localTree(listed.filter((r) => matches(r, v.filter))), [listed, v.filter]);
  // ponytail: the local filter is search.all on the tests — steps, sources, filters (review:…) and meaning; the plain
  // text match above shows until it answers, or when it cannot
  const smart = useSearch(v.tab === "local" ? needle : "", { in: ["test"], k: 300 });
  const ranked = useMemo(() => {
    if (!smart.result) return null;
    const byId = new Map(listed.map((r) => [r.id, r]));
    return smart.result.hits.flatMap((h) => {
      const r = byId.get(h.id);
      return h.kind === "test" && r ? [{ hit: h, ref: r }] : [];
    });
  }, [smart.result, listed]);

  // ponytail: runs when the connection changes, not when the screen comes back
  // biome-ignore lint/correctness/useExhaustiveDependencies: the drafts' setters are stable
  useEffect(() => {
    if (v.jira === jiraFor) return;
    v.setJira(jiraFor);
    v.setFolder("/");
    v.setSearch("");
  }, [jiraFor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the drafts' setters are stable
  useEffect(() => {
    if (query) v.setTab("jira");
  }, [query]);

  // ponytail: a test opened from elsewhere (Ctrl K, Review) shows in the local panes — its folder picked, unfolded
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the open test, not every pick of a folder
  useEffect(() => {
    if (!active) return;
    const f = active.folder || "/";
    if (f === v.localFolder) return;
    v.setLocalFolder(f);
    v.setShut((s) => {
      for (const a of ancestors(f)) s.delete(a);
      return s;
    });
  }, [activeId, active?.folder]);

  // ponytail: a pull from the list is a job like any other — said once it starts (« Show the job » follows it, and cancels
  // it there), its outcome said when it ends
  const pull = async (input: { key?: string; folder?: string }, label: string) => {
    setBusy((b) => [...b, label]);
    try {
      const r = await run<PullResult>("xray.pull", input, undefined, (jobId) =>
        jobToast(`Pulling ${label} — started`, jobId, app.openJob),
      );
      await onReload();
      const n = r?.pulled?.length ?? 0;
      if (r?.failed?.length)
        errorToast(new Error(r.failed.map((f) => `${f.key}: ${f.error}`).join("; ")), "Some tests failed to pull");
      if (r?.skipped?.length)
        toast({ tone: "neutral", title: `${plural(r.skipped.length, "test")} skipped`, detail: r.skipped[0].reason });
      if (n) toast({ tone: "success", title: `${plural(n, "test")} pulled`, detail: label });
    } catch (e) {
      errorToast(e, `Could not pull ${label}`);
    } finally {
      setBusy((b) => b.filter((x) => x !== label));
    }
  };

  const openRemote = (t: RemoteTestRef) => {
    const local = refs.find((r) => r.key === t.key);
    if (local) onOpen(local.id);
    else if (onPull) onPull(t.key, t.summary);
    else void pull({ key: t.key }, t.key);
  };

  const pickFolder = (path: string) => {
    v.setFolder(path);
    if (query || needle) {
      v.setSearch("");
      v.setFilter("");
      v.setExpanded((s) => new Set([...s, ...ancestors(path)]));
      return;
    }
    v.setExpanded((s) => {
      if (s.has(path) && path === v.folder) s.delete(path);
      else s.add(path);
      return s;
    });
  };

  const { folder: newFolder, create } = useNewTest(active?.folder, async (id) => {
    await onReload();
    onOpen(id);
  });
  const lockOf = (id: string) => claudeLock(app.claudeRunning, id);
  const activeLock = activeId ? lockOf(activeId) : false;

  const clone = () => {
    if (!activeId || activeLock) return;
    void cloneTest(client, app, activeId, onOpen);
  };

  const pullActive = () => {
    if (!active?.key) {
      v.setTab("jira");
      toast({ tone: "neutral", title: "Pick a folder or a test in Jira", detail: "This test has never been pushed." });
    } else void replacing.ask(active.id, active.key);
  };

  const deleted = (id: string) => {
    setDoomed(null);
    if (onDeleted) onDeleted(id);
    else void onReload();
  };

  // ponytail: the row's delete decides as the editor's menu does — saved first, what is lost read from the file
  const askDelete = async (r: LocalTestRef) => {
    const lock = lockOf(r.id);
    if (lock) return toast({ tone: "neutral", title: "Wait for Claude to finish", detail: lock });
    const target = await deleteTarget(client, r.id);
    if (!target) return;
    if (needsAsking(target)) setDoomed(target);
    else if (await deleteTest(client, target)) deleted(r.id);
  };

  const local = () => {
    if (!project()) return <p {...stylex.props(type.small, styles.note)}>No project open.</p>;
    if (loading && !refs.length)
      return (
        <div role="status" aria-label="Loading tests">
          <List
            label="Local tests"
            items={[]}
            getKey={String}
            renderItem={() => ({ title: "" })}
            loading={4}
            reading="tests.list"
          />
        </div>
      );
    if (!listed.length)
      return waiting ? (
        <EmptyState
          icon="review"
          compact
          title="Nothing here yet"
          text={`${plural(waiting, "generated test")} waiting for review. Create one, or pull from Jira.`}
          actions={<Button size="sm" label="Review them" onClick={() => app.navigate("review")} />}
        />
      ) : (
        <EmptyState
          icon="tests"
          compact
          title="No test yet"
          text="Create one, pull from Jira, or generate them from the documents."
        />
      );
    const none = (
      <EmptyState
        icon="filter"
        compact
        title={`No local test matches “${v.filter}”.`}
        actions={<Button size="sm" label="Clear the filter" onClick={() => v.setFilter("")} />}
      />
    );
    if (needle && ranked)
      return ranked.length ? (
        <FoundList
          found={ranked}
          searching={smart.loading}
          activeId={activeId}
          onOpen={({ hit, ref }) => {
            jumpTo(ref.id, hit.step);
            onOpen(ref.id);
          }}
        />
      ) : (
        none
      );
    if (!shown.total) return none;
    const toggle = (path: string) =>
      v.setShut((s) => {
        if (s.has(path)) s.delete(path);
        else s.add(path);
        return s;
      });
    if (localPanes)
      return (
        <LocalPanes
          layout={localKept as JiraLayout}
          root={shown}
          folder={v.localFolder}
          shut={v.shut}
          activeId={activeId}
          onPickFolder={v.setLocalFolder}
          onToggle={toggle}
          onOpen={onOpen}
          locked={lockOf}
          onDelete={(r) => void askDelete(r)}
          onNew={() => void create()}
        />
      );
    return (
      <LocalTree
        root={shown}
        shut={v.shut}
        forceOpen={!!v.filter}
        activeId={activeId}
        getKey={(r) => r.id}
        renderTest={(r) => testItem(r, lockOf, (x) => void askDelete(x))}
        onOpen={onOpen}
        onToggle={toggle}
      />
    );
  };

  return (
    <aside aria-label="Tests" {...stylex.props(styles.side)}>
      <div {...stylex.props(styles.head)}>
        <TestsTabs
          value={v.tab}
          onPick={v.setTab}
          local={listed.length}
          jira={tree?.totalCount}
          jiraOff={!!p?.jiraOffline}
        />
      </div>
      {
        <ListTools
          jira={jiraOn || v.tab === "jira"}
          jiraOff={!jiraOn}
          assignees={jiraOn || listed.some((r) => r.assignee) ? assignees : undefined}
          local={v.tab === "local"}
          search={v.search}
          filter={v.filter}
          newFolder={newFolder}
          canClone={!activeId ? "Open a test to clone it" : activeLock}
          pullBusy={!!active && (replacing.busy(active.id) || (!!active.key && busy.includes(active.key)))}
          pullLock={activeLock}
          canReveal={!!activeId && !!project()}
          reveal={!!desktop()}
          layout={
            v.tab === "local" ? (project() && listed.length ? localKept : undefined) : jiraPanes ? layout : undefined
          }
          withTree={v.tab === "local"}
          onLayout={(l) => (v.tab === "local" ? setLocalLayout(l) : l !== "tree" && setLayout(l))}
          noProject={!project()}
          onSearch={v.setSearch}
          onFilter={v.setFilter}
          onFilterEnter={() => needle && jiraOn && v.setSearch(needle)}
          onNew={() => void create()}
          onClone={clone}
          onPull={pullActive}
          onReveal={() => {
            const dir = project();
            if (dir && activeId) void reveal(pathJoin(dir, "tests", activeId, "test.md"));
          }}
        />
      }
      <div {...stylex.props(styles.body, (jiraPanes || localPanes) && styles.panes)}>
        {v.tab === "local" ? (
          <>
            {waiting > 0 && listed.length > 0 && (
              <div {...stylex.props(styles.waiting)}>
                <Banner
                  tone="info"
                  compact
                  icon="eye"
                  actions={<Button size="sm" label="Review" onClick={() => app.navigate("review")} />}
                >
                  {waiting === 1 ? "1 new test waits for review" : `${waiting} new tests wait for review`}
                </Banner>
              </div>
            )}
            {needle && jiraOn && (
              <Button
                variant="quiet"
                icon="search"
                block
                label={`Search Jira for “${needle}”`}
                onClick={() => v.setSearch(needle)}
              />
            )}
            {local()}
          </>
        ) : !jiraOn || treeError ? (
          <JiraConnect key={jiraFor} error={treeError} onConnected={() => void treeQ.refetch()} />
        ) : (
          <>
            <div {...stylex.props(type.small, styles.conn)}>
              <Icon name="cloud" size="sm" />
              <span {...stylex.props(styles.grow)}>Connected to {p?.jiraProject}</span>
              <Button size="xs" variant="quiet" label="Disconnect" onClick={() => void disconnect()} />
            </div>
            <JiraTab
              layout={layout}
              tree={tree}
              query={query}
              filter={needle}
              folder={v.folder}
              expanded={v.expanded}
              refs={refs}
              activeId={activeId}
              pulling={[...pulling, ...busy]}
              busyFolders={busy}
              onPickFolder={pickFolder}
              onOpenRemote={openRemote}
              onPullFolder={(path) => void pull({ folder: path }, path)}
              onNew={() => void create()}
            />
          </>
        )}
      </div>
      {doomed && <DeleteTest target={doomed} onClose={() => setDoomed(null)} onDeleted={() => deleted(doomed.id)} />}
      {replacing.dialog}
    </aside>
  );
}
