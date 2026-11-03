import { useEffect, useRef, useState } from "react";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
import { Badge, type BadgeTone, Button, Icon, IconButton, Skeleton, SyncBadge } from "../../components/ui/index.ts";
import { cx, plural } from "../../lib/format.ts";
import { track } from "../../lib/localActivity.ts";
import { errorToast } from "../../lib/toast.ts";

export const PAGE = 100;

// ponytail: the loading states are the lists' own rhythm at the real sizes, so nothing moves when rows land
const TREE_SK = [96, 62, 84, 108, 72];
const ROW_SK = ["100%", "82%", "94%", "76%", "88%", "70%"];

export const treeSkeleton = (
  <div className="jtree sk-fade" role="status" aria-label="Loading folders">
    {TREE_SK.map((w, i) => (
      <div key={w} className="sk-tree" style={{ paddingLeft: 12 + (i ? 16 : 0) }}>
        <Skeleton w={12} h={9} />
        <Skeleton w={w} h={11} />
        <Skeleton w={i ? 20 : 26} h={9} style={{ marginLeft: "auto" }} />
      </div>
    ))}
  </div>
);

export const rowSkeleton = (n: number, label: string) => (
  <div className="sk-fade" role="status" aria-busy="true" aria-label={label}>
    {ROW_SK.slice(0, n).map((w) => (
      <div key={w} className="sk-trow">
        <Skeleton w={w} h={12} />
        <span className="sk-trow-meta">
          <Skeleton w={84} h={9} />
          <Skeleton w={40} h={14} r={7} />
          <Skeleton w={34} h={9} style={{ marginLeft: "auto" }} />
        </span>
      </div>
    ))}
  </div>
);

export const statusTone = (s: string): BadgeTone =>
  /done|ready|closed|pass/i.test(s) ? "ok" : /review|progress|block/i.test(s) ? "warn" : "neutral";

export const folderName = (path: string) => (path === "/" ? "Test Repository" : path);

type Row = { folder: Folder; depth: number };

const flatten = (f: Folder, open: (path: string) => boolean, depth = 0, out: Row[] = []): Row[] => {
  out.push({ folder: f, depth });
  if (open(f.path)) for (const c of f.folders) flatten(c, open, depth + 1, out);
  return out;
};

export const findFolder = (f: Folder | null, path: string): Folder | null => {
  if (!f) return null;
  if (f.path === path) return f;
  for (const c of f.folders) {
    const hit = findFolder(c, path);
    if (hit) return hit;
  }
  return null;
};

type List = { tests: RemoteTestRef[]; total: number };

export function JiraTab({
  tree,
  treeError,
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
  tree: Folder | null;
  treeError: string;
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
  const [list, setList] = useState<List>({ tests: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement | null>(null);
  // ponytail: what the accumulated list already holds — a ref, because the sentinel fires from an
  // IntersectionObserver callback, outside render, and two intersections must not ask for one slice twice
  const at = useRef({ key: "", page: 0, busy: false, total: 0 });
  const listKey = `${project() ?? ""}|${folder}|${query}`;
  const empty = !query && findFolder(tree, folder)?.testsCount === 0;
  // ponytail: a folder is listed once the tree says how many tests it holds directly — an empty one is
  // never asked for
  const ready = !!query || !!tree;

  const loadSlice = (key: string, page: number) => {
    const a = at.current;
    if (a.key === key && (a.busy || (page > 0 && page * PAGE >= a.total))) return;
    at.current = { key, page, busy: true, total: page ? a.total : 0 };
    const mine = () => at.current.key === key && at.current.page === page;
    setLoading(true);
    const input = query ? { text: query } : { folder, page };
    track(
      "jira",
      query ? `Searching Jira for “${query}”` : `Loading ${folderName(folder)}`,
      call<List>("xray.search", input),
    )
      .then((r) => {
        if (!mine()) return;
        const tests = r?.tests ?? [];
        const total = query ? tests.length : (r?.total ?? tests.length);
        at.current.total = total;
        setList((prev) => (page ? { tests: [...prev.tests, ...tests], total } : { tests, total }));
      })
      .catch((e) => {
        if (!mine()) return;
        if (!page) setList({ tests: [], total: 0 });
        errorToast(e, query ? "Jira search failed" : `Could not list ${folderName(folder)}`);
        // ponytail: a slice that failed is asked for again on the next intersection, not skipped
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

  // ponytail: the sentinel's own visibility is the trigger — no scroll handler, and re-observing after
  // every append chain-loads while it is still on screen
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe after every slice
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadSlice(listKey, at.current.page + 1);
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [listKey, list.tests.length]);

  const needle = filter.toLowerCase();
  const rows = tree
    ? needle
      ? flatten(tree, () => true).filter((r) => r.folder.path !== "/" && r.folder.name.toLowerCase().includes(needle))
      : flatten(tree, (p) => expanded.has(p))
    : [];
  const shownTests = needle
    ? list.tests.filter((t) => t.summary.toLowerCase().includes(needle) || t.key.toLowerCase().includes(needle))
    : list.tests;
  const busy = loading && !list.tests.length;
  const filling = !query && list.tests.length > 0 && list.tests.length < list.total;
  const complete = !query && list.total > PAGE && list.tests.length >= list.total;
  const byKey = new Map(refs.filter((r) => r.key).map((r) => [r.key as string, r]));

  const remoteRow = (t: RemoteTestRef) => {
    const local = byKey.get(t.key);
    const busyRow = pulling.includes(t.key);
    return (
      <button
        key={t.key}
        type="button"
        className={cx("trow jrow", (local?.id === activeId || t.key === activeId) && "trow-on")}
        title={
          local ? undefined : busyRow ? "Being pulled now" : "Not pulled yet — opening it downloads it into the project"
        }
        aria-current={local?.id === activeId || t.key === activeId || undefined}
        onClick={() => onOpenRemote(t)}
      >
        <span className="trow-title">{t.summary}</span>
        <span className="trow-meta">
          <span className="mono muted">{t.key}</span>
          {t.status && (
            <Badge small tone={statusTone(t.status)} className="jrow-status">
              {t.status}
            </Badge>
          )}
          {local && <SyncBadge sync={local.sync} small />}
          <span className="jrow-steps mono">{busyRow ? "pulling…" : plural(t.stepCount, "step")}</span>
        </span>
      </button>
    );
  };

  return (
    <>
      {treeError ? (
        <div className="tside-empty">
          <p>Jira could not be reached.</p>
          <p className="muted">{treeError}</p>
        </div>
      ) : !tree ? (
        !query && treeSkeleton
      ) : (
        <div className="jtree">
          {rows.map(({ folder: f, depth }) => {
            const isOpen = expanded.has(f.path);
            return (
              <div key={f.path} className="tree-line">
                <button
                  type="button"
                  className={cx("tree jfolder", f.path === folder && !query && "jfolder-on")}
                  style={{ paddingLeft: 12 + (needle ? 0 : depth) * 16 }}
                  aria-expanded={f.folders.length && !needle ? isOpen : undefined}
                  aria-current={(f.path === folder && !query) || undefined}
                  title={needle ? f.path : undefined}
                  onClick={() => onPickFolder(f.path)}
                >
                  <span className="jfolder-twisty">
                    {f.folders.length > 0 && !needle && <Icon name={isOpen ? "down" : "right"} />}
                  </span>
                  <Icon name="folder" />
                  <span className={cx("tree-name", f.path === "/" && "jfolder-root")}>
                    {f.path === "/" ? "Test Repository" : f.name}
                  </span>
                  <span
                    className="jfolder-count mono"
                    title={`${f.testsCount} directly in this folder, ${f.totalCount} including sub-folders`}
                  >
                    {f.testsCount === f.totalCount ? f.totalCount : `${f.testsCount}/${f.totalCount}`}
                  </span>
                </button>
                {f.totalCount > 0 && (
                  <IconButton
                    icon="pull"
                    label={`Pull every test of ${folderName(f.path)}`}
                    disabled={busyFolders.includes(f.path)}
                    onClick={() => onPullFolder(f.path)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {ready && (
        <div className="jlist">
          <div className="jlist-head">
            <span className={cx("jlist-path", !query && folder === "/" ? "jlist-root" : "mono")}>
              {query ? `search “${query}”` : folderName(folder)}
            </span>
            {busy ? (
              <Skeleton w={54} h={9} />
            ) : (
              <span className="jlist-range">
                {query ? `${list.tests.length} found` : list.total ? `${list.tests.length} of ${list.total}` : "0"}
              </span>
            )}
          </div>
          {busy ? (
            rowSkeleton(6, query ? `Searching Jira for ${query}` : `Loading tests in ${folderName(folder)}`)
          ) : shownTests.length ? (
            shownTests.map(remoteRow)
          ) : list.tests.length ? (
            <p className="muted tside-empty">No listed test matches “{filter}”.</p>
          ) : query ? (
            <p className="muted tside-empty">Nothing in Jira matches “{query}”.</p>
          ) : (
            <div className="tside-empty jempty">
              <p className="jempty-title">No tests in this folder</p>
              <p className="muted">{folderName(folder)} is empty. Pick another folder, or create a test locally.</p>
              <Button size="sm" icon="plus" onClick={onNew}>
                New local test
              </Button>
            </div>
          )}
          {filling && <div ref={sentinel}>{rowSkeleton(2, `Loading more tests in ${folderName(folder)}`)}</div>}
          {complete && (
            <div className="jlist-end">
              <span />
              all {list.total} loaded
              <span />
            </div>
          )}
        </div>
      )}
    </>
  );
}
