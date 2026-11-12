import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useState } from "react";
import type { Review } from "../../../core/types.ts";
import { FilterBar } from "../../components/filters/FilterBar.tsx";
import { LAYOUTS, type ListLayout } from "../../components/tree/FolderPanes.tsx";
import { LocalTree } from "../../components/tree/LocalTree.tsx";
import { TreePanes } from "../../components/tree/TreePanes.tsx";
import { ancestors, localTree } from "../../components/tree/tree.ts";
import { Badge, ReviewBadge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Kbd } from "../../components/ui/Kbd.tsx";
import { List } from "../../components/ui/List.tsx";
import { Pane } from "../../components/ui/Pane.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { usePref } from "../../lib/prefs.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { filtered, type QueueFilters, queueOptions } from "./queueFilters.ts";
import type { QueueGroup } from "./queueGroups.ts";
import { FilteredEmpty } from "./ReviewEmpty.tsx";

export type QueueItem = {
  id: string;
  key?: string;
  summary: string;
  folder: string;
  review: Review;
  note?: string;
  edited?: boolean;
  unchecked: boolean;
  errors: number;
  warnings: number;
  infos: number;
  stale: boolean;
  mtime: number;
  generatedBy?: string;
  generatedAt?: string;
};
export type QueueCounts = { toFix: number; draft: number; unchecked: number; validated?: number };
export type QueueSort = "anomalies" | "state" | "folder" | "recent";

const SORTS: { value: QueueSort; label: string }[] = [
  { value: "anomalies", label: "Most issues" },
  { value: "state", label: "State" },
  { value: "recent", label: "Recent" },
];

const styles = stylex.create({
  queue: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: color.surface,
  },
  tools: {
    flex: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingTop: space.s3,
    paddingInline: space.s4,
    paddingBottom: space.s4,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
  },
  none: { margin: 0, padding: space.s5, color: color.textMuted },
  notice: { paddingTop: space.s3, paddingInline: space.s3 },
  body: { boxSizing: "border-box", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: space.s5 },
  panes: { display: "flex", flexDirection: "column", overflowY: "hidden", paddingBottom: 0 },
  foot: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted },
  grow: { flex: 1 },
  keys: { display: "inline-flex", alignItems: "center", gap: space.s2, whiteSpace: "nowrap" },
});

function Counts({ item }: { item: QueueItem }) {
  if (item.unchecked) return <Badge size="sm" icon="clock" label="Not checked yet" />;
  const quiet = item.stale;
  const out: ReactNode[] = [];
  if (item.errors)
    out.push(
      <Badge
        key="e"
        size="sm"
        tone={quiet ? "neutral" : "danger"}
        icon="x-circle"
        label={plural(item.errors, "error")}
      />,
    );
  if (item.warnings)
    out.push(
      <Badge
        key="w"
        size="sm"
        tone={quiet ? "neutral" : "warning"}
        icon="alert-triangle"
        label={plural(item.warnings, "warning")}
      />,
    );
  if (item.infos)
    out.push(<Badge key="i" size="sm" tone={quiet ? "neutral" : "info"} icon="info" label={`${item.infos} info`} />);
  if (!out.length && !item.stale) out.push(<span key="ok">No findings</span>);
  if (item.stale) out.push(<Badge key="s" size="sm" icon="history" label="Changed since its check" />);
  return <>{out}</>;
}

const tip = (t: QueueItem) =>
  [t.key ?? "Not in Jira yet", testLabel(t), t.folder || "/"].join(" — ") +
  (t.edited ? " · edited since it was generated" : "");

export type ReviewQueueProps = {
  /** the tests shown, after the filters */
  items: QueueItem[] | null;
  /** the latest generation, then « Earlier », when the queue holds tests of more than one generation */
  groups?: QueueGroup[];
  /** the whole queue, before the filters: what the menus count */
  queued: QueueItem[];
  counts: QueueCounts | null;
  activeId: string;
  filters: QueueFilters;
  sort: QueueSort;
  onWords: (words: string) => void;
  onStates: (states: string[]) => void;
  onChecks: (checks: string[]) => void;
  onFolders: (folders: string[]) => void;
  onSort: (s: QueueSort) => void;
  /** back to the whole queue: every filter off (the empty state's « Clear the filters ») */
  onClearFilters?: () => void;
  onOpen: (id: string) => void;
  /** a read of the queue that failed, with a way to ask again */
  error?: { message: string; onRetry: () => void };
  notice?: ReactNode;
};

// ponytail: the generated tests waiting for a person — the filter bar (words, review state, what the check found,
// folder) over the tests filed by folder as Tests files them — one tree, or the folders and the tests of the folder
// picked in two panes (the layout is kept), by generation; the sort is the pane's own and orders the tests inside a
// folder. The folder of the test opened (J/K, a decision) is unfolded and picked. Validated tests leave the queue
export function ReviewQueue(p: ReviewQueueProps) {
  const all = p.counts ? p.counts.toFix + p.counts.draft : undefined;
  const narrowed = filtered(p.filters);
  const options = queueOptions(p.queued, p.filters);
  const [kept, setLayout] = usePref("reviewLayout");
  const layout = kept as ListLayout;
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState("/");
  const activeFolder = (p.items?.find((t) => t.id === p.activeId) ?? p.items?.[0])?.folder;
  useEffect(() => {
    if (activeFolder === undefined) return;
    setFolder(activeFolder || "/");
    const up = ancestors(activeFolder);
    setShut((s) => {
      const kept = [...s].filter((k) => !up.includes(k.slice(k.indexOf("|") + 1)));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [activeFolder]);
  const toggle = (fold: string) =>
    setShut((s) => {
      const n = new Set(s);
      if (!n.delete(fold)) n.add(fold);
      return n;
    });
  const items = p.items ?? [];
  const row = (t: QueueItem) => ({
    title: testLabel(t),
    tooltip: tip(t),
    meta: (
      <>
        <ReviewBadge state={t.review} size="sm" />
        <Counts item={t} />
      </>
    ),
  });
  const panes = layout !== "tree" && items.length > 0;
  const root = p.groups
    ? p.groups.map((g) => ({
        label: g.label,
        meta: g.meta,
        root: localTree(
          items.filter((t) => g.keys.includes(t.id)),
          false,
        ),
      }))
    : localTree(items, false);
  return (
    <div {...stylex.props(styles.queue)}>
      <Pane
        as="aside"
        label="Review queue"
        title="Queue"
        fill
        scroll={false}
        tools={all !== undefined && <Badge count size="sm" label={String(all)} />}
        actions={
          <Select
            label="Sort the queue"
            appearance="quiet"
            size="sm"
            icon="sort"
            value={p.sort}
            options={SORTS}
            onChange={p.onSort}
          />
        }
      >
        <div {...stylex.props(styles.tools)}>
          <FilterBar
            label="Filter the queue"
            placeholder="Filter — summary or key"
            words={p.filters.words}
            onWords={p.onWords}
            shown={p.items?.length ?? 0}
            total={p.queued.length}
            onClear={() => p.onClearFilters?.()}
            end={
              <Segmented<ListLayout>
                size="sm"
                label="Folders and tests"
                value={layout}
                onChange={setLayout}
                options={LAYOUTS}
              />
            }
            menus={[
              {
                key: "state",
                label: "State",
                options: options.states,
                selected: p.filters.states,
                onChange: p.onStates,
              },
              {
                key: "findings",
                label: "Findings",
                options: options.checks,
                selected: p.filters.checks,
                onChange: p.onChecks,
                note: "What its last check found. Ticks add up: a test shows when it has any of them.",
              },
              {
                key: "folder",
                label: "Folder",
                icon: "folder",
                options: options.folders,
                selected: p.filters.folders,
                onChange: p.onFolders,
              },
            ]}
          />
        </div>
        {p.error && (
          <div {...stylex.props(styles.notice)}>
            <Banner
              tone="danger"
              compact
              title="Could not read the review queue"
              actions={<Button size="sm" label="Retry" onClick={p.error.onRetry} />}
            >
              {p.error.message}
            </Banner>
          </div>
        )}
        {p.notice && <div {...stylex.props(styles.notice)}>{p.notice}</div>}
        <div {...stylex.props(styles.body, panes && styles.panes)}>
          {panes ? (
            <TreePanes<QueueItem>
              name="review"
              label="Queue"
              layout={layout === "columns" ? "columns" : "rows"}
              root={localTree(items, false)}
              folder={folder}
              shut={shut}
              activeId={p.activeId}
              getKey={(t) => t.id}
              renderTest={row}
              groups={(tests) =>
                p.groups?.map((g) => {
                  const keys = g.keys.filter((k) => tests.some((t) => t.id === k));
                  return { label: g.label, meta: String(keys.length), keys };
                })
              }
              empty={(picked) => (
                <EmptyState
                  icon="folder"
                  compact
                  title="No test directly in this folder"
                  text={`${plural(picked.total, "test")} in its sub-folders.`}
                />
              )}
              onPickFolder={setFolder}
              onToggle={toggle}
              onOpen={p.onOpen}
            />
          ) : p.items?.length ? (
            <LocalTree<QueueItem>
              label="Tests to review"
              root={root}
              shut={shut}
              forceOpen={false}
              activeId={p.activeId}
              getKey={(t) => t.id}
              onOpen={p.onOpen}
              onToggle={toggle}
              renderTest={row}
            />
          ) : (
            <List
              label="Tests to review"
              items={[]}
              loading={p.items === null ? 5 : false}
              reading="review.queue"
              getKey={(t: QueueItem) => t.id}
              renderItem={() => ({ title: "" })}
              empty={
                !narrowed ? (
                  <p {...stylex.props(type.small, styles.none)}>The queue is empty.</p>
                ) : (
                  <FilteredEmpty compact onClear={p.onClearFilters} />
                )
              }
            />
          )}
        </div>
      </Pane>
    </div>
  );
}

// ponytail: the queue section's foot — where the open test sits in the queue, previous and next (J and K do the same
// from anywhere, the queue folded or not)
export function QueueFoot({ at, total, onMove }: { at: number; total: number; onMove: (by: 1 | -1) => void }) {
  return (
    <div {...stylex.props(type.small, styles.foot)}>
      <Button
        size="sm"
        variant="quiet"
        iconOnly
        icon="chevron-up"
        label="Previous test (K)"
        disabled={!total}
        onClick={() => onMove(-1)}
      />
      <span data-testid="queue-position" {...stylex.props(type.tabular)}>
        {total ? `${Math.max(0, at) + 1} / ${total}` : "0"}
      </span>
      <Button
        size="sm"
        variant="quiet"
        iconOnly
        icon="chevron-down"
        label="Next test (J)"
        disabled={!total}
        onClick={() => onMove(1)}
      />
      <span {...stylex.props(styles.grow)} />
      <span {...stylex.props(styles.keys)}>
        <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous
      </span>
    </div>
  );
}
