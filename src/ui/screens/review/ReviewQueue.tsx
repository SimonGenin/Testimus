import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Review } from "../../../core/types.ts";
import { FilterBar } from "../../components/filters/FilterBar.tsx";
import { Badge, ReviewBadge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { List } from "../../components/ui/List.tsx";
import { Pane } from "../../components/ui/Pane.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { border, color, container, shadow, size, space, z } from "../../styles/tokens.stylex.ts";
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
  { value: "folder", label: "Folder" },
  { value: "recent", label: "Recent" },
];

const styles = stylex.create({
  queue: {
    flex: "none",
    width: size.sidebar,
    display: { default: "flex", [container.reviewQueue]: "none" },
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: color.surface,
  },
  over: {
    display: "flex",
    position: { default: "static", [container.reviewQueue]: "absolute" },
    insetBlock: 0,
    insetInlineStart: size.controlLg,
    zIndex: z.drawer,
    boxShadow: { default: null, [container.reviewQueue]: shadow.s2 },
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
  width?: number;
  /** the queue shown over the test while the screen is too narrow for both (« Show the queue » of the folded strip) */
  over?: boolean;
};

// ponytail: the generated tests waiting for a person — the filter bar (words, review state, what the check found,
// folder) over the list by generation; the sort is the pane's own. Validated tests leave the queue: Tests holds them
export function ReviewQueue(p: ReviewQueueProps) {
  const all = p.counts ? p.counts.toFix + p.counts.draft : undefined;
  const narrowed = filtered(p.filters);
  const options = queueOptions(p.queued, p.filters);
  return (
    <div {...stylex.props(styles.queue, p.over && styles.over)} style={p.width ? { width: p.width } : undefined}>
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
        <div {...stylex.props(styles.body)}>
          <List
            label="Tests to review"
            density="two-line"
            items={p.items ?? []}
            groups={p.groups}
            loading={p.items === null ? 5 : false}
            reading="review.queue"
            getKey={(t) => t.id}
            selected={p.activeId}
            onSelect={p.onOpen}
            renderItem={(t) => ({
              title: testLabel(t),
              tooltip: tip(t),
              meta: (
                <>
                  <ReviewBadge state={t.review} size="sm" />
                  <Counts item={t} />
                </>
              ),
            })}
            empty={
              !narrowed ? (
                <p {...stylex.props(type.small, styles.none)}>The queue is empty.</p>
              ) : (
                <FilteredEmpty compact onClear={p.onClearFilters} />
              )
            }
          />
        </div>
      </Pane>
    </div>
  );
}
