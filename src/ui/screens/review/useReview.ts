import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CommandInput } from "../../../core/commands/index.ts";
import type { CheckFile, SyncState, Test } from "../../../core/types.ts";
import { flushAutosaves, useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Prefix, read, useRead } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { byGeneration } from "./queueGroups.ts";
import type { QueueCounts, QueueFilter, QueueItem, QueueSort } from "./ReviewQueue.tsx";
import { useJobRun } from "./useJobRun.ts";

export type Loaded = {
  id: string;
  test: Test;
  sync: SyncState;
  edited: boolean;
  check: CheckFile | null;
  stale: boolean;
};

const STATES: Record<QueueFilter, CommandInput<"review.queue">["state"]> = {
  all: undefined,
  checked: ["checked"],
  "to-fix": ["to-fix"],
  validated: ["validated"],
};

const NONE: QueueItem[] = [];

const draft = (name: string) => [project(), `review.${name}`] as const;

// ponytail: the queue's filters are presentation kept for the life of the page, like any unsent choice
export function useQueueFilters() {
  const [filter, setFilter] = useDraft(draft("filter"), "all");
  const [sort, setSort] = useDraft(draft("sort"), "anomalies");
  const [folder, setFolder] = useDraft(draft("folder"), "");
  const [findings, setFindings] = useDraft(draft("withFindings"), "");
  return {
    filter: filter as QueueFilter,
    sort: sort as QueueSort,
    folder,
    withFindings: findings === "1",
    setFilter: (f: QueueFilter) => setFilter(f),
    setSort: (s: QueueSort) => setSort(s),
    setFolder,
    setWithFindings: (on: boolean) => setFindings(on ? "1" : ""),
  };
}

export type Filters = ReturnType<typeof useQueueFilters>;

export const queueInput = (f: Pick<Filters, "filter" | "folder" | "withFindings" | "sort">) => ({
  ...(STATES[f.filter] ? { state: STATES[f.filter] } : {}),
  ...(f.folder ? { folder: f.folder } : {}),
  ...(f.withFindings ? { withFindings: true } : {}),
  sort: f.sort,
});

export function useReviewData(routeId: string, filters: Filters) {
  const input = queueInput(filters);
  const queue = useRead("review.queue", input, { keepPrevious: true });
  const whole = useRead("review.queue", {});
  const listed = queue.isSuccess ? (queue.data?.tests ?? NONE) : undefined;
  const grouped = useMemo(() => (listed ? byGeneration(listed as QueueItem[]) : null), [listed]);
  const items: QueueItem[] | null = grouped ? grouped.items : queue.isError ? [] : null;
  const all = whole.data?.tests ?? [];
  const activeId = routeId || items?.[0]?.id || "";
  const shown = useRead("tests.show", { id: activeId }, { enabled: !!activeId });
  const checked = useRead("check.show", { id: activeId }, { enabled: !!activeId });
  const claude = useRead("claude.status");
  const s = shown.data;
  const checkDone = !!checked.data || checked.isError;
  const data: Loaded | null =
    s && s.id === activeId && checkDone
      ? {
          id: s.id,
          test: s.test as Test,
          sync: s.sync,
          edited: s.edited,
          check: (checked.data?.check as CheckFile | null | undefined) ?? null,
          stale: !!checked.data?.stale,
        }
      : null;
  return {
    input,
    items,
    groups: grouped?.groups,
    counts: (queue.data?.counts ?? null) as QueueCounts | null,
    queueError: queue.isError ? queue.error.message : "",
    retryQueue: () => void queue.refetch(),
    folders: [...new Set(all.map((t) => t.folder).filter(Boolean))].sort(),
    unchecked: all.filter((t) => t.unchecked).map((t) => t.id),
    needsCheck: all.filter((t) => t.unchecked || t.stale).map((t) => t.id),
    activeId,
    data,
    loadError: shown.isError ? shown.error.message : "",
    claudeReady: !claude.data || (!!claude.data.installed && claude.data.signedIn !== false),
  };
}

const decided = (id: string): Prefix[] => [
  ["review.queue"],
  ["tests.show", { id }],
  ["check.show", { id }],
  ["tests.list"],
  ["project.info"],
  ["search.all"],
];

// ponytail: the reviewer's gestures, one command each; the queue read again after a decision says which test is next
export function useDecisions(input: ReturnType<typeof queueInput>, open: (id: string | null) => void) {
  const client = useQueryClient();
  const check = useJobRun("check.run");
  const pull = useJobRun("xray.pull");

  const next = async (id: string, before: QueueItem[]) => {
    const at = before.findIndex((t) => t.id === id);
    const list = byGeneration((await read(client, "review.queue", input)).tests).items;
    const after = list.find((t, i) => i >= at && t.id !== id) ?? list.filter((t) => t.id !== id).pop();
    open(after?.id ?? null);
  };

  const decide = async (id: string, label: string, before: QueueItem[], note?: string) => {
    const toFix = note !== undefined;
    try {
      await execute(client, "review.set", toFix ? { id, decision: "to-fix", note } : { id, decision: "validate" }, {
        invalidates: decided(id),
        flushFirst: [["tests.show", { id }]],
      });
    } catch (e) {
      errorToast(e, toFix ? "Could not mark the test To fix" : "Could not validate the test");
      return false;
    }
    toast(
      toFix
        ? { kind: "info", title: "Marked To fix", detail: label }
        : { kind: "ok", title: "Validated", detail: label },
    );
    await next(id, before);
    return true;
  };

  return {
    validate: (id: string, label: string, before: QueueItem[]) => decide(id, label, before),
    markToFix: (id: string, label: string, before: QueueItem[], note: string) => decide(id, label, before, note),
    flush: (id: string) => flushAutosaves([["tests.show", { id }]]),
    checking: check.running,
    check: (ids: string[]) => {
      if (!ids.length || check.running) return;
      void check.start(
        { ids },
        {
          failed: (e) =>
            errorToast(new Error(e), ids.length === 1 ? "Could not check the test" : "Could not check the tests"),
        },
      );
    },
    pulling: pull.running,
    takeJira: (key: string) =>
      void pull.start(
        { key, overwrite: true },
        {
          done: () => toast({ kind: "ok", title: "Jira's version taken", detail: key }),
          failed: (e) => errorToast(new Error(e), `Could not pull ${key}`),
        },
      ),
  };
}
