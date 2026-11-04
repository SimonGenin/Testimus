import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { project, run } from "../../lib/data/client.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { jumpTo, useSearch } from "../../lib/search.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { type DeleteTarget, DeleteTest, deleteTest, needsAsking } from "./DeleteTest.tsx";
import { JiraConnect } from "./JiraConnect.tsx";
import { JiraTab } from "./JiraTab.tsx";
import { FoundList } from "./list/FoundList.tsx";
import { ListTools } from "./list/ListTools.tsx";
import { LocalTree } from "./list/LocalTree.tsx";
import { ancestors, isKeyQuery, type Listed, localTree, matches } from "./list/tree.ts";
import { useListView } from "./list/useListView.ts";
import { TestsTabs } from "./TestsTabs.tsx";

export { isKeyQuery, localTree };

const styles = stylex.create({
  side: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", backgroundColor: color.surface },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingInline: space.s3,
    paddingTop: space.s2,
  },
  grow: { flex: 1 },
  note: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    color: color.textMuted,
  },
  body: { flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: space.s2 },
  conn: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    color: color.textMuted,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
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
  /** in the drawer of a narrow window: how to close it */
}) {
  const app = useApp();
  const client = useQueryClient();
  const p = app.info?.project;
  const jiraOn = !!p?.jiraProject && !p.jiraOffline;
  // ponytail: what the Jira side was loaded for — a new key, a reconnect or a disconnect starts it again
  const jiraFor = jiraOn ? `${app.info?.dir}|${p.jiraProject}` : "";
  const v = useListView();
  const treeQ = useRead("xray.folders", {}, { enabled: jiraOn });
  const tree = jiraOn ? ((treeQ.data as Folder | undefined) ?? null) : null;
  const treeError = jiraOn && treeQ.error ? message(treeQ.error) : "";
  const [busy, setBusy] = useState<string[]>([]);
  const [doomed, setDoomed] = useState<DeleteTarget | null>(null);
  const [overwrite, setOverwrite] = useState<LocalTestRef | null>(null);
  const active = refs.find((r) => r.id === activeId);
  const query = v.search.trim();
  const needle = v.filter.trim();

  const listed = useMemo(() => refs.filter((r) => !(r as Listed).awaiting), [refs]);
  const waiting = refs.length - listed.length;
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

  const pull = async (input: { key?: string; folder?: string; overwrite?: boolean }, label: string) => {
    setBusy((b) => [...b, label]);
    try {
      const r = await run<PullResult>("xray.pull", input);
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

  const newFolder = v.tab === "jira" && !query ? v.folder : (active?.folder ?? "/");
  const create = async () => {
    try {
      const r = (await execute(
        client,
        "tests.create",
        { folder: newFolder, summary: "New test" },
        {
          invalidates: [["tests.list"], ["project.info"]],
        },
      )) as { id: string };
      await onReload();
      onOpen(r.id);
    } catch (e) {
      errorToast(e, "Could not create the test");
    }
  };

  const clone = async () => {
    if (!activeId) return;
    try {
      const r = (await execute(
        client,
        "tests.clone",
        { id: activeId },
        {
          invalidates: [["tests.list"], ["project.info"]],
          flushFirst: [["tests.show", { id: activeId }]],
        },
      )) as { id: string };
      await onReload();
      onOpen(r.id);
    } catch (e) {
      errorToast(e, "Could not clone the test");
    }
  };

  const pullActive = () => {
    if (!active?.key) {
      v.setTab("jira");
      toast({ tone: "neutral", title: "Pick a folder or a test in Jira", detail: "This test has never been pushed." });
    } else if (active.dirty) setOverwrite(active);
    else void pull({ key: active.key }, active.key);
  };

  const deleted = (id: string) => {
    setDoomed(null);
    if (onDeleted) onDeleted(id);
    else void onReload();
  };

  const askDelete = (r: LocalTestRef) => {
    if (needsAsking(r)) setDoomed(r);
    else void deleteTest(client, r).then((ok) => ok && deleted(r.id));
  };

  const disconnect = async () => {
    try {
      await execute(client, "xray.disconnect", {}, { invalidates: [["project.info"], ["xray.folders"]] });
      app.refreshInfo();
      toast({
        tone: "neutral",
        title: "Working locally",
        detail: `Nothing reads or writes ${p?.jiraProject} until you reconnect.`,
      });
    } catch (e) {
      errorToast(e, "Could not disconnect Jira");
    }
  };

  const local = () => {
    if (!project()) return <p {...stylex.props(type.small, styles.note)}>No project open.</p>;
    if (loading && !refs.length)
      return (
        <div role="status" aria-label="Loading tests">
          <List label="Local tests" items={[]} getKey={String} renderItem={() => ({ title: "" })} loading={4} />
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
    return (
      <LocalTree
        root={shown}
        shut={v.shut}
        forceOpen={!!v.filter}
        activeId={activeId}
        onOpen={onOpen}
        onToggle={(path) =>
          v.setShut((s) => {
            if (s.has(path)) s.delete(path);
            else s.add(path);
            return s;
          })
        }
        onDelete={askDelete}
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
        <span {...stylex.props(styles.grow)} />
      </div>
      {
        <ListTools
          jira={jiraOn || v.tab === "jira"}
          jiraOff={!jiraOn}
          local={v.tab === "local"}
          search={v.search}
          filter={v.filter}
          newFolder={newFolder}
          canClone={!!activeId}
          pullBusy={!!active?.key && busy.includes(active.key)}
          canReveal={!!activeId && !!project()}
          reveal={!!desktop()}
          noProject={!project()}
          onSearch={v.setSearch}
          onFilter={v.setFilter}
          onFilterEnter={() => needle && jiraOn && v.setSearch(needle)}
          onNew={() => void create()}
          onClone={() => void clone()}
          onPull={pullActive}
          onReveal={() => {
            const dir = project();
            if (dir && activeId) void reveal(pathJoin(dir, "tests", activeId, "test.md"));
          }}
        />
      }
      <div {...stylex.props(styles.body)}>
        {v.tab === "local" ? (
          <>
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
      {overwrite?.key && (
        <Modal
          title={`Replace ${overwrite.key} with Jira's version?`}
          size="sm"
          confirm={{
            verb: "Pull and replace",
            danger: true,
            onConfirm: () => {
              const key = overwrite.key as string;
              setOverwrite(null);
              void pull({ key, overwrite: true }, key);
            },
          }}
          onClose={() => setOverwrite(null)}
        >
          {overwrite.key} has local changes. Pulling replaces them with what Jira has.
        </Modal>
      )}
    </aside>
  );
}
