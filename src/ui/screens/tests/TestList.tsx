import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { call, project, run } from "../../api.ts";
import { Button, Icon, IconButton, ReviewBadge, Skeleton, SyncBadge, Tabs } from "../../components/ui/index.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { cx, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

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
}: {
  refs: LocalTestRef[];
  loading: boolean;
  activeId: string;
  onOpen: (id: string) => void;
  onReload: () => Promise<LocalTestRef[]>;
}) {
  const [tab, setTab] = useState<"local" | "jira">("local");
  const [q, setQ] = useState("");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [tree, setTree] = useState<Folder | null>(null);
  const [treeError, setTreeError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["/"]));
  const [remote, setRemote] = useState<Record<string, RemoteTestRef[] | "loading">>({});
  const [found, setFound] = useState<RemoteTestRef[] | null>(null);
  const [pulling, setPulling] = useState<string[]>([]);
  const active = refs.find((r) => r.id === activeId);

  const shown = useMemo(() => localTree(refs.filter((r) => matches(r, q))), [refs, q]);

  const asked = useRef(new Set<string>());
  const loadFolder = useCallback((path: string) => {
    if (asked.current.has(path)) return;
    asked.current.add(path);
    setRemote((m) => ({ ...m, [path]: "loading" }));
    call<{ tests: RemoteTestRef[] }>("xray.search", { folder: path })
      .then((r) => setRemote((m) => ({ ...m, [path]: r.tests ?? [] })))
      .catch((e) => {
        asked.current.delete(path);
        setRemote((m) => {
          const n = { ...m };
          delete n[path];
          return n;
        });
        errorToast(e, `Could not list ${path}`);
      });
  }, []);

  useEffect(() => {
    if (tab !== "jira" || tree) return;
    call<Folder>("xray.folders", {})
      .then((t) => {
        setTree(t);
        if (t.testsCount) loadFolder(t.path);
      })
      .catch((e) => setTreeError(e instanceof Error ? e.message : String(e)));
  }, [tab, tree, loadFolder]);

  useEffect(() => {
    if (tab !== "jira" || !q.trim()) {
      setFound(null);
      return;
    }
    const t = setTimeout(() => {
      call<{ tests: RemoteTestRef[] }>("xray.search", { text: q.trim() })
        .then((r) => setFound(r.tests ?? []))
        .catch((e) => errorToast(e, "Jira search failed"));
    }, 300);
    return () => clearTimeout(t);
  }, [tab, q]);

  const pull = async (input: { key?: string; folder?: string; overwrite?: boolean }, label: string) => {
    setPulling((p) => [...p, label]);
    try {
      const r = await run<PullResult>("xray.pull", input);
      const after = await onReload();
      const n = r.pulled?.length ?? 0;
      if (r.failed?.length)
        errorToast(new Error(r.failed.map((f) => `${f.key}: ${f.error}`).join("; ")), "Some tests failed to pull");
      if (r.skipped?.length)
        toast({ kind: "info", title: `${plural(r.skipped.length, "test")} skipped`, detail: r.skipped[0].reason });
      if (n) toast({ kind: "ok", title: `${plural(n, "test")} pulled`, detail: label });
      if (input.key) {
        const ref = after.find((x) => x.key === input.key);
        if (ref) onOpen(ref.id);
      }
    } catch (e) {
      errorToast(e, `Could not pull ${label}`);
    } finally {
      setPulling((p) => p.filter((x) => x !== label));
    }
  };

  const openRemote = (t: RemoteTestRef) => {
    const local = refs.find((r) => r.key === t.key);
    if (local) onOpen(local.id);
    else void pull({ key: t.key }, t.key);
  };

  const create = async () => {
    try {
      const folder = active?.folder ?? "/";
      const r = await call<{ id: string }>("tests.create", { folder, summary: "New test" });
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
              <button
                key={r.id}
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
            ))}
          </>
        )}
      </div>
    );
  };

  const remoteRow = (t: RemoteTestRef, depth: number) => {
    const local = refs.find((r) => r.key === t.key);
    return (
      <button
        key={t.key}
        type="button"
        className={cx("trow", local?.id === activeId && "trow-on")}
        style={{ paddingLeft: 30 + depth * 16 }}
        disabled={pulling.includes(t.key)}
        onClick={() => openRemote(t)}
      >
        <span className="trow-title">{t.summary}</span>
        <span className="trow-meta">
          <span className="mono muted">{t.key}</span>
          <span className="muted">{t.status}</span>
          {local ? (
            <SyncBadge sync={local.sync} small />
          ) : (
            <span className="muted">{pulling.includes(t.key) ? "Pulling…" : "Not pulled"}</span>
          )}
        </span>
      </button>
    );
  };

  const jiraNode = (f: Folder, depth: number): React.ReactNode => {
    const isOpen = open.has(f.path);
    const tests = remote[f.path];
    return (
      <div key={f.path}>
        {f.path !== "/" && (
          <div className="tree-line" style={{ paddingLeft: 12 + (depth - 1) * 16 }}>
            <button
              type="button"
              className="tree"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen((s) => {
                  const next = new Set(s);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  return next;
                });
                if (!isOpen && f.testsCount) loadFolder(f.path);
              }}
            >
              <Icon name={isOpen ? "down" : "right"} />
              <Icon name="folder" />
              <span className="tree-name">{f.name}</span>
              <span className="muted">{f.totalCount}</span>
            </button>
            <IconButton
              icon="pull"
              label={`Pull every test of ${f.path}`}
              disabled={pulling.includes(f.path)}
              onClick={() => void pull({ folder: f.path }, f.path)}
            />
          </div>
        )}
        {isOpen && (
          <>
            {f.folders.map((c) => jiraNode(c, depth + 1))}
            {tests === "loading" ? (
              <div className="sk-row" style={{ paddingLeft: 30 + depth * 16 }}>
                <Skeleton w="80%" h={12} />
                <Skeleton w="40%" h={10} />
              </div>
            ) : (
              tests?.map((t) => remoteRow(t, depth))
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="tside" aria-label="Tests">
      <Tabs
        label="Where"
        className="tside-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: "local", label: "Local" },
          { value: "jira", label: "Jira" },
        ]}
      />
      <div className="tside-tools">
        <label htmlFor="tsearch" className="sr">
          Search tests
        </label>
        <input
          id="tsearch"
          className="field tside-search"
          placeholder={tab === "local" ? "Search by text or key" : "Search Jira by text or key"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="tside-actions">
          <Button size="sm" icon="plus" onClick={() => void create()}>
            New test
          </Button>
          <Button size="sm" tone="quiet" icon="clone" disabled={!activeId} onClick={() => void clone()}>
            Clone
          </Button>
          <Button
            size="sm"
            tone="quiet"
            icon="pull"
            disabled={!!active?.key && pulling.includes(active.key)}
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
          loading && !refs.length ? (
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
          )
        ) : found ? (
          found.length ? (
            found.map((t) => remoteRow(t, 0))
          ) : (
            <p className="muted tside-empty">Nothing in Jira matches “{q}”.</p>
          )
        ) : tree ? (
          jiraNode(tree, 0)
        ) : treeError ? (
          <div className="tside-empty">
            <p>Jira could not be reached.</p>
            <p className="muted">{treeError}</p>
          </div>
        ) : (
          listSkeleton
        )}
      </div>
    </aside>
  );
}
