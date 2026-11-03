import { useEffect, useMemo, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { call, project, run } from "../../api.ts";
import { Activity } from "../../components/shell/Activity.tsx";
import { Button, Icon, IconButton, ReviewBadge, Skeleton, SyncBadge, Tabs } from "../../components/ui/index.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { cx, plural } from "../../lib/format.ts";
import { track } from "../../lib/localActivity.ts";
import { readPref, writePref } from "../../lib/theme.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { type DeleteTarget, DeleteTest, deleteTest, needsAsking } from "./DeleteTest.tsx";
import { JiraTab } from "./JiraTab.tsx";
import { RecentList } from "./RecentList.tsx";

type Node = { name: string; path: string; tests: LocalTestRef[]; folders: Node[]; total: number };

export function localTree(refs: LocalTestRef[]): Node {
  const root: Node = { name: "/", path: "/", tests: [], folders: [], total: 0 };
  for (const r of refs) {
    let at = root;
    root.total++;
    let path = "";
    for (const part of (r.folder || "/").split("/").filter(Boolean)) {
      path += `/${part}`;
      let next = at.folders.find((f) => f.path === path);
      if (!next) {
        next = { name: part, path, tests: [], folders: [], total: 0 };
        at.folders.push(next);
      }
      next.total++;
      at = next;
    }
    at.tests.push(r);
  }
  const sort = (n: Node) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.tests.sort((a, b) => a.summary.localeCompare(b.summary));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

const matches = (r: LocalTestRef, q: string) =>
  !q || `${r.key ?? ""} ${r.summary} ${r.id}`.toLowerCase().includes(q.toLowerCase());

// ponytail: an issue key or its bare number is a question only Jira answers (xray.search completes the number)
export const isKeyQuery = (q: string) => /^([A-Za-z][A-Za-z0-9]*-)?[0-9]+$/.test(q.trim());

const ancestors = (path: string) => {
  const out = ["/"];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `/${part}`;
    out.push(at);
  }
  return out;
};

type PullResult = {
  pulled: string[];
  skipped: { key: string; reason: string }[];
  failed: { key: string; error: string }[];
};

const listSkeleton = (
  <div className="tlist" role="status" aria-busy="true" aria-label="Loading tests">
    {[60, 55, 65, 50].map((w) => (
      <div key={w} className="sk-row">
        <Skeleton w={`${w}%`} h={10} />
        <Skeleton w="92%" h={12} />
        <Skeleton w="48%" h={18} r={9} />
      </div>
    ))}
  </div>
);

export function TestList({
  refs,
  loading,
  activeId,
  onOpen,
  onReload,
  pulling = [],
  onPull,
  onDeleted,
  open = false,
  onCloseDrawer,
}: {
  refs: LocalTestRef[];
  loading: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onReload: () => Promise<LocalTestRef[]>;
  pulling?: string[];
  onPull?: (key: string, summary: string) => void;
  onDeleted?: (id: string) => void;
  open?: boolean;
  onCloseDrawer?: () => void;
}) {
  const [tab, setTab] = useState<"local" | "jira">("local");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [tree, setTree] = useState<Folder | null>(null);
  const [treeError, setTreeError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [folder, setFolder] = useState("/");
  const [busy, setBusy] = useState<string[]>([]);
  const [doomed, setDoomed] = useState<DeleteTarget | null>(null);
  const [showRecent, setShowRecent] = useState(() => readPref("testimus.showRecent", ["1", "0"], "1") === "1");
  const active = refs.find((r) => r.id === activeId);
  // ponytail: two boxes, as in Xray Editor — « Search Jira » (any text jumps to the Jira tab and asks Jira) and
  // « Filter tests » (narrows what is listed: local tests, Jira folders, the loaded Jira rows)
  const query = search.trim();
  const needle = q.trim();

  const shown = useMemo(() => localTree(refs.filter((r) => matches(r, q))), [refs, q]);

  useEffect(() => {
    if (tree || treeError) return;
    let dead = false;
    track("jira", "Loading the Jira folders", call<Folder>("xray.folders", {}))
      .then((t) => !dead && setTree(t))
      .catch((e) => !dead && setTreeError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
  }, [tree, treeError]);

  useEffect(() => {
    if (query) setTab("jira");
  }, [query]);

  const pull = async (input: { key?: string; folder?: string; overwrite?: boolean }, label: string) => {
    setBusy((p) => [...p, label]);
    try {
      const r = await run<PullResult>("xray.pull", input);
      await onReload();
      const n = r?.pulled?.length ?? 0;
      if (r?.failed?.length)
        errorToast(new Error(r.failed.map((f) => `${f.key}: ${f.error}`).join("; ")), "Some tests failed to pull");
      if (r?.skipped?.length)
        toast({ kind: "info", title: `${plural(r.skipped.length, "test")} skipped`, detail: r.skipped[0].reason });
      if (n) toast({ kind: "ok", title: `${plural(n, "test")} pulled`, detail: label });
    } catch (e) {
      errorToast(e, `Could not pull ${label}`);
    } finally {
      setBusy((p) => p.filter((x) => x !== label));
    }
  };

  const openRemote = (t: RemoteTestRef) => {
    const local = refs.find((r) => r.key === t.key);
    if (local) onOpen(local.id);
    else if (onPull) onPull(t.key, t.summary);
    else void pull({ key: t.key }, t.key);
  };

  const pickFolder = (path: string) => {
    setFolder(path);
    if (query || needle) {
      setSearch("");
      setQ("");
      setExpanded((s) => new Set([...s, ...ancestors(path)]));
      return;
    }
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path) && path === folder) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const newFolder = tab === "jira" && !query ? folder : (active?.folder ?? "/");

  const create = async () => {
    try {
      const r = await call<{ id: string }>("tests.create", { folder: newFolder, summary: "New test" });
      await onReload();
      onOpen(r.id);
    } catch (e) {
      errorToast(e, "Could not create the test");
    }
  };

  const clone = async () => {
    if (!activeId) return;
    try {
      const r = await call<{ id: string }>("tests.clone", { id: activeId });
      await onReload();
      onOpen(r.id);
    } catch (e) {
      errorToast(e, "Could not clone the test");
    }
  };

  const pullActive = () => {
    if (active?.key) {
      if (active.dirty && !window.confirm(`${active.key} has local changes. Replace them with Jira's version?`)) return;
      void pull({ key: active.key, overwrite: active.dirty }, active.key);
    } else {
      setTab("jira");
      toast({ kind: "info", title: "Pick a folder or a test in Jira", detail: "This test has never been pushed." });
    }
  };

  const deleted = (id: string) => {
    setDoomed(null);
    if (onDeleted) onDeleted(id);
    else void onReload();
  };

  const askDelete = (r: LocalTestRef) => {
    if (needsAsking(r)) setDoomed(r);
    else void deleteTest(r).then((ok) => ok && deleted(r.id));
  };

  const toggleRecent = () => {
    const next = !showRecent;
    setShowRecent(next);
    writePref("testimus.showRecent", next ? "1" : "0");
  };

  const localNode = (n: Node, depth: number) => {
    const isOpen = !shut.has(n.path) || !!q;
    return (
      <div key={n.path}>
        {n.path !== "/" && (
          <button
            type="button"
            className="tree"
            style={{ paddingLeft: 12 + (depth - 1) * 16 }}
            aria-expanded={isOpen}
            onClick={() =>
              setShut((s) => {
                const next = new Set(s);
                if (next.has(n.path)) next.delete(n.path);
                else next.add(n.path);
                return next;
              })
            }
          >
            <Icon name={isOpen ? "down" : "right"} />
            <Icon name="folder" />
            <span className="tree-name">{n.name}</span>
            <span className="muted">{n.total}</span>
          </button>
        )}
        {isOpen && (
          <>
            {n.folders.map((f) => localNode(f, depth + 1))}
            {n.tests.map((r) => (
              <div key={r.id} className="trow-wrap">
                <button
                  type="button"
                  className={cx("trow", r.id === activeId && "trow-on")}
                  style={{ paddingLeft: 30 + depth * 16 }}
                  aria-current={r.id === activeId || undefined}
                  onClick={() => onOpen(r.id)}
                >
                  <span className="trow-title">{r.summary || "Untitled"}</span>
                  <span className="trow-meta">
                    <span className="mono muted">{r.key ?? "no key"}</span>
                    <ReviewBadge review={r.review} small />
                    <SyncBadge sync={r.sync} small />
                  </span>
                </button>
                <IconButton
                  icon="close"
                  className="trow-del"
                  label={`Delete the local copy of ${r.key ?? (r.summary || r.id)}`}
                  title="Delete the local copy"
                  onClick={() => askDelete(r)}
                />
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className={cx("tside", open && "is-open")} aria-label="Tests">
      <div className="tside-head">
        <Tabs
          label="Where"
          className="tside-tabs"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "local",
              label: (
                <>
                  Local <span className="tab-count">{refs.length}</span>
                </>
              ),
            },
            {
              value: "jira",
              label: (
                <>
                  Jira{" "}
                  {tree ? (
                    <span className="tab-count">{tree.totalCount}</span>
                  ) : treeError ? null : (
                    <Skeleton className="tab-count" w={18} h={8} />
                  )}
                </>
              ),
            },
          ]}
        />
        <span className="spacer" />
        <Activity />
        <IconButton icon="close" className="tside-close" label="Close list" onClick={onCloseDrawer} />
      </div>
      <div className="tside-tools">
        <label htmlFor="tjira" className="sr">
          Search Jira
        </label>
        <input
          id="tjira"
          type="search"
          className="field tside-search"
          placeholder="Search Jira tests, or an issue key…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label htmlFor="tsearch" className="sr">
          Filter tests
        </label>
        <input
          id="tsearch"
          className="field tside-search"
          placeholder={tab === "local" ? "Filter by text or key" : "Filter folders and listed tests"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // ponytail: Enter sends the filter to Jira as a search (a shortcut to the box above)
            if (e.key === "Enter" && needle) {
              e.preventDefault();
              setSearch(needle);
            }
          }}
        />
        <div className="tside-actions">
          <IconButton
            icon="clock"
            className="tside-recent"
            label="Recent tests"
            title={showRecent ? "Hide recent tests" : "Show recent tests"}
            aria-pressed={showRecent}
            onClick={toggleRecent}
          />
          <Button size="sm" icon="plus" title={`New local test in ${newFolder}`} onClick={() => void create()}>
            New test
          </Button>
          <Button size="sm" tone="quiet" icon="clone" disabled={!activeId} onClick={() => void clone()}>
            Clone
          </Button>
          <Button
            size="sm"
            tone="quiet"
            icon="pull"
            disabled={!!active?.key && busy.includes(active.key)}
            onClick={pullActive}
          >
            Pull
          </Button>
          {desktop() && (
            <IconButton
              icon="external"
              label="Show the test in Explorer"
              disabled={!activeId || !project()}
              onClick={() => {
                const dir = project();
                if (dir && activeId) void reveal(pathJoin(dir, "tests", activeId, "test.md"));
              }}
            />
          )}
        </div>
      </div>
      <div className="tside-list">
        {tab === "local" ? (
          <>
            {needle && (
              <button type="button" className="tside-jira" onClick={() => setSearch(needle)}>
                <Icon name="search" />
                <span>Search Jira for “{needle}”</span>
              </button>
            )}
            {loading && !refs.length ? (
              listSkeleton
            ) : refs.length ? (
              shown.total ? (
                localNode(shown, 0)
              ) : (
                <p className="muted tside-empty">No local test matches “{q}”.</p>
              )
            ) : (
              <div className="tside-empty">
                <p className="muted">No tests yet. Create one, pull from Jira, or generate them from the documents.</p>
              </div>
            )}
          </>
        ) : (
          <JiraTab
            tree={tree}
            treeError={treeError}
            query={query}
            filter={needle}
            folder={folder}
            expanded={expanded}
            refs={refs}
            activeId={activeId}
            pulling={[...pulling, ...busy]}
            busyFolders={busy}
            onPickFolder={pickFolder}
            onOpenRemote={openRemote}
            onPullFolder={(path) => void pull({ folder: path }, path)}
            onNew={() => void create()}
          />
        )}
      </div>
      {showRecent && <RecentList refs={refs} onOpen={onOpen} />}
      {doomed && <DeleteTest target={doomed} onClose={() => setDoomed(null)} onDeleted={() => deleted(doomed.id)} />}
    </aside>
  );
}
