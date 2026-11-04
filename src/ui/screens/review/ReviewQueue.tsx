import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Review } from "../../../core/types.ts";
import { Badge, ReviewBadge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { plural } from "../../lib/format.ts";
import { border, color, container, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";

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
};
export type QueueCounts = { checked: number; toFix: number; draft: number; unchecked: number; validated?: number };
export type QueueFilter = "all" | "checked" | "to-fix" | "validated";
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
  head: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: space.s5,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
  },
  title: { fontSize: fontSize.titleSm, lineHeight: lineHeight.titleSm, fontWeight: fontWeight.semibold },
  grow: { flex: 1, minWidth: 0 },
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
  row: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, flexWrap: "wrap" },
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
    out.push(
      <Badge key="i" size="sm" tone={quiet ? "neutral" : "info"} icon="info" label={plural(item.infos, "note")} />,
    );
  if (!out.length && !item.stale)
    out.push(<Badge key="ok" size="sm" tone="success" icon="check" label="No findings" />);
  if (item.stale) out.push(<Badge key="s" size="sm" icon="history" label="Changed since its check" />);
  return <>{out}</>;
}

const tip = (t: QueueItem) =>
  [t.key ?? "Not in Jira yet", t.summary || "Untitled test", t.folder || "/"].join(" — ") +
  (t.edited ? " · edited since it was generated" : "");

export type ReviewQueueProps = {
  items: QueueItem[] | null;
  counts: QueueCounts | null;
  activeId: string;
  filter: QueueFilter;
  sort: QueueSort;
  folder: string;
  folders: string[];
  withFindings: boolean;
  onFilter: (f: QueueFilter) => void;
  onSort: (s: QueueSort) => void;
  onFolder: (f: string) => void;
  onWithFindings: (on: boolean) => void;
  onOpen: (id: string) => void;
  /** the tests that need the check (never checked, or changed since): « Check all » runs it on them */
  checkAll?: { ids: string[]; running: boolean; onCheck: () => void };
  /** a read of the queue that failed, with a way to ask again */
  error?: { message: string; onRetry: () => void };
  notice?: ReactNode;
  width?: number;
};

export function ReviewQueue(p: ReviewQueueProps) {
  const all = p.counts ? p.counts.checked + p.counts.toFix + p.counts.draft : undefined;
  const narrowed = p.filter !== "all" || !!p.folder || p.withFindings;
  return (
    <aside aria-label="Review queue" {...stylex.props(styles.queue)} style={p.width ? { width: p.width } : undefined}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.title)}>Queue</span>
        {all !== undefined && <Badge count size="sm" label={String(all)} />}
        <span {...stylex.props(styles.grow)} />
        {p.checkAll && (
          <Button
            size="sm"
            variant="quiet"
            icon="eye"
            label="Check all"
            loading={p.checkAll.running}
            disabled={!p.checkAll.ids.length && "Every test of the queue is checked and up to date"}
            onClick={p.checkAll.onCheck}
          />
        )}
      </div>
      <div {...stylex.props(styles.tools)}>
        <Segmented
          size="sm"
          label="Filter by review state"
          value={p.filter}
          onChange={p.onFilter}
          options={[
            { value: "all", label: "All", count: all },
            { value: "checked", label: "Checked", count: p.counts?.checked },
            { value: "to-fix", label: "To fix", count: p.counts?.toFix },
            { value: "validated", label: "Validated", count: p.counts?.validated },
          ]}
        />
        <div {...stylex.props(styles.row)}>
          <Select
            label="Sort the queue"
            appearance="quiet"
            size="sm"
            prefix="Sort"
            value={p.sort}
            options={SORTS}
            onChange={p.onSort}
          />
          <Select
            label="Filter by folder"
            appearance="quiet"
            size="sm"
            icon="folder"
            value={p.folder}
            options={[{ value: "", label: "All folders" }, ...p.folders.map((f) => ({ value: f, label: f }))]}
            onChange={p.onFolder}
          />
        </div>
        <Checkbox label="Only with findings" checked={p.withFindings} onChange={p.onWithFindings} />
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
          loading={p.items === null ? 5 : false}
          getKey={(t) => t.id}
          selected={p.activeId}
          onSelect={p.onOpen}
          renderItem={(t) => ({
            title: t.summary || "Untitled test",
            tooltip: tip(t),
            meta: (
              <>
                <ReviewBadge state={t.review} size="sm" />
                <Counts item={t} />
              </>
            ),
          })}
          empty={
            <EmptyState
              compact
              icon="validated"
              title={p.filter === "validated" ? "No generated test validated yet" : "Nothing waiting for review"}
              text={
                !narrowed
                  ? "Generated tests land here once written, until you validate them."
                  : p.filter === "validated" && !p.folder && !p.withFindings
                    ? "A generated test stays readable here once validated, and also appears in Tests."
                    : "No test matches these filters."
              }
            />
          }
        />
      </div>
    </aside>
  );
}
