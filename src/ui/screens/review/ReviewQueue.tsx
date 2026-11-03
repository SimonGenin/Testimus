import type { ReactNode } from "react";
import type { Review } from "../../../core/types.ts";
import { ActionButton } from "../../components/claude/ActionButton.tsx";
import {
  Button,
  GeneratedBadge,
  Icon,
  Menu,
  ReviewBadge,
  Segmented,
  Severity,
  Skeleton,
} from "../../components/ui/index.ts";
import { useActions } from "../../lib/actions.ts";
import { cx, plural } from "../../lib/format.ts";

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

const SORTS: Record<QueueSort, string> = {
  anomalies: "Most issues first",
  state: "By review state",
  folder: "By folder",
  recent: "Last edited first",
};

function Counts({ item }: { item: QueueItem }) {
  if (item.unchecked) return <Severity tone="stale">Not checked yet</Severity>;
  const tone = item.stale ? "stale" : undefined;
  if (!item.errors && !item.warnings && !item.infos) return <Severity tone="ok">No findings</Severity>;
  return (
    <>
      {item.errors > 0 && <Severity tone={tone ?? "error"}>{plural(item.errors, "error")}</Severity>}
      {item.warnings > 0 && <Severity tone={tone ?? "warning"}>{plural(item.warnings, "warning")}</Severity>}
      {item.infos > 0 && <Severity tone={tone ?? "info"}>{plural(item.infos, "note")}</Severity>}
    </>
  );
}

export function ReviewQueue({
  items,
  counts,
  activeId,
  filter,
  sort,
  folder,
  folders,
  withFindings,
  onFilter,
  onSort,
  onFolder,
  onWithFindings,
  onOpen,
  head,
}: {
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
  head?: ReactNode;
}) {
  const all = counts ? counts.checked + counts.toFix + counts.draft : undefined;
  const acts = useActions({});
  return (
    <aside className="queue" aria-label="Review queue">
      {head}
      <div className="queue-filters">
        <Segmented
          label="Filter by review state"
          value={filter}
          onChange={onFilter}
          options={[
            { value: "all", label: "All", count: all },
            { value: "checked", label: "Checked", count: counts?.checked },
            { value: "to-fix", label: "To fix", count: counts?.toFix },
            { value: "validated", label: "Validated", count: counts?.validated },
          ]}
        />
        <div className="queue-menus">
          <Menu
            label="Sort the queue"
            trigger={({ open, toggle, id }) => (
              <Button size="sm" className="queue-menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
                <span>{withFindings ? "With findings" : SORTS[sort]}</span>
                <Icon name="down" />
              </Button>
            )}
            items={[
              ...(Object.keys(SORTS) as QueueSort[]).map((s) => ({
                key: s,
                label: SORTS[s],
                on: sort === s,
                onSelect: () => onSort(s),
              })),
              { kind: "sep" as const, key: "sep" },
              {
                key: "findings",
                label: "Only tests with findings",
                icon: withFindings ? ("check" as const) : undefined,
                on: withFindings,
                onSelect: () => onWithFindings(!withFindings),
              },
            ]}
          />
          <Menu
            label="Filter by folder"
            align="right"
            trigger={({ open, toggle, id }) => (
              <Button size="sm" className="queue-menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
                <span className="queue-menu-text">{folder || "All folders"}</span>
                <Icon name="down" />
              </Button>
            )}
            items={[
              { key: "", label: "All folders", on: !folder, onSelect: () => onFolder("") },
              ...folders.map((f) => ({ key: f, label: f, on: folder === f, onSelect: () => onFolder(f) })),
            ]}
          />
        </div>
      </div>
      <div className="queue-list">
        {!items ? (
          <div role="status" aria-busy="true" aria-label="Loading the queue">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="qrow">
                <Skeleton w={96} h={10} />
                <Skeleton w="86%" h={14} />
                <Skeleton w={130} h={10} />
                <Skeleton w={150} h={18} r={9} />
              </div>
            ))}
          </div>
        ) : !items.length ? (
          <div className="queue-empty">
            <Icon name="validated" size={28} />
            <p className="h">
              {filter === "validated" ? "No generated test validated yet" : "Nothing waiting for review"}
            </p>
            <p className="muted">
              {filter === "all" && !folder && !withFindings
                ? "Generated tests land here once written, until you validate them."
                : filter === "validated" && !folder && !withFindings
                  ? "A generated test stays readable here once validated, and also appears in Tests."
                  : "No test matches these filters."}
            </p>
          </div>
        ) : (
          items.map((t) => {
            const mine = acts.filter((a) => a.where === `test:${t.id}`);
            return (
              <div key={t.id} className="qrow-wrap">
                <button
                  type="button"
                  className={cx("qrow", t.id === activeId && "qrow-on", mine.length > 0 && "qrow-with-cab")}
                  aria-current={t.id === activeId ? "true" : undefined}
                  data-id={t.id}
                  onClick={() => onOpen(t.id)}
                >
                  <span className="mono muted">{t.key ?? "Not in Jira yet"}</span>
                  <span className="qrow-title">{t.summary || "Untitled test"}</span>
                  <span className="muted qrow-folder">{t.folder || "/"}</span>
                  <span className="qrow-badges">
                    <GeneratedBadge edited={t.edited} small />
                    <ReviewBadge review={t.review} small />
                    <Counts item={t} />
                  </span>
                </button>
                {mine.length > 0 && (
                  <span className="qrow-cab">
                    <ActionButton action={mine[0]} compact />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
