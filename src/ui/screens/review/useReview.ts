import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CheckFile, SyncState, Test } from "../../../core/types.ts";
import type { Screen } from "../../lib/app.ts";
import { flushAutosaves, useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Prefix, read, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, jobToast, toast } from "../../lib/toast.ts";
import { useReplaceWithJira } from "../tests/replace.tsx";
import { keepQueued, type QueueCheck, type QueueFilters } from "./queueFilters.ts";
import { byGeneration } from "./queueGroups.ts";
import type { QueueCounts, QueueItem, QueueSort } from "./ReviewQueue.tsx";
import { useJobRun } from "./useJobRun.ts";

export type Loaded = {
  id: string;
  test: Test;
  sync: SyncState;
  edited: boolean;
  check: CheckFile | null;
  stale: boolean;
};

const NONE: QueueItem[] = [];

const draft = (name: string) => [project(), `review.${name}`] as const;
const list = (v: string): string[] => (v ? JSON.parse(v) : []);

// ponytail: the queue's filters are presentation kept for the life of the page, like any unsent choice; the queue is
// read whole (draft and to-fix) and narrowed here (queueFilters.ts), so every menu can count what it holds
export function useQueueFilters() {
  const [words, setWords] = useDraft(draft("words"), "");
  const [states, setStates] = useDraft(draft("states"), "");
  const [checks, setChecks] = useDraft(draft("checks"), "");
  const [folders, setFolders] = useDraft(draft("folders"), "");
  const [sort, setSort] = useDraft(draft("sort"), "anomalies");
  const value = useMemo<QueueFilters>(
    () => ({
      words,
      states: list(states) as QueueFilters["states"],
      checks: list(checks) as QueueCheck[],
      folders: list(folders),
    }),
    [words, states, checks, folders],
  );
  return {
    value,
    sort: sort as QueueSort,
    setWords,
    setStates: (v: string[]) => setStates(v.length ? JSON.stringify(v) : ""),
    setChecks: (v: string[]) => setChecks(v.length ? JSON.stringify(v) : ""),
    setFolders: (v: string[]) => setFolders(v.length ? JSON.stringify(v) : ""),
    setSort: (s: QueueSort) => setSort(s),
    clear: () => {
      setWords("");
      setStates("");
      setChecks("");
      setFolders("");
    },
  };
}

export type Filters = ReturnType<typeof useQueueFilters>;

export const queueInput = (f: Pick<Filters, "sort">) => ({ sort: f.sort });

export function useReviewData(routeId: string, filters: Filters) {
  const input = queueInput(filters);
  const queue = useRead("review.queue", input, { keepPrevious: true });
  const whole = useRead("review.queue", {});
  const fetched = queue.isSuccess ? ((queue.data?.tests ?? NONE) as QueueItem[]) : undefined;
  const listed = useMemo(() => (fetched ? keepQueued(fetched, filters.value) : undefined), [fetched, filters.value]);
  const grouped = useMemo(() => (listed ? byGeneration(listed) : null), [listed]);
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
    queued: fetched ?? NONE,
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
export function useDecisions(
  input: ReturnType<typeof queueInput>,
  filters: QueueFilters,
  open: (id: string | null) => void,
  navigate: (screen: Screen, arg?: string) => void,
) {
  const client = useQueryClient();
  const check = useJobRun("check.run");
  const replacing = useReplaceWithJira();

  const next = async (id: string, before: QueueItem[]) => {
    const at = before.findIndex((t) => t.id === id);
    const list = byGeneration(keepQueued((await read(client, "review.queue", input)).tests, filters)).items;
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
        ? { tone: "neutral", title: "Marked To fix", detail: label }
        : { tone: "success", title: "Validated", detail: label },
    );
    await next(id, before);
    return true;
  };

  return {
    validate: (id: string, label: string, before: QueueItem[]) => decide(id, label, before),
    toDraft: async (id: string, label: string) => {
      try {
        await execute(
          client,
          "review.set",
          { id, decision: "draft" },
          { invalidates: decided(id), flushFirst: [["tests.show", { id }]] },
        );
        toast({ tone: "neutral", title: "Back to Draft", detail: label });
      } catch (e) {
        errorToast(e, "Could not take the To fix mark off");
      }
    },
    markToFix: (id: string, label: string, before: QueueItem[], note: string) => decide(id, label, before, note),
    flush: (id: string) => flushAutosaves([["tests.show", { id }]]),
    checking: check.running,
    check: (ids: string[]) => {
      if (!ids.length || check.running) return;
      void check.start(
        { ids },
        {
          started: (jobId) => jobToast(`Checking ${plural(ids.length, "test")}`, jobId, navigate),
          failed: (e) =>
            errorToast(new Error(e), ids.length === 1 ? "Could not check the test" : "Could not check the tests"),
        },
      );
    },
    // ponytail: the same « Replace with Jira's version » as the editor and the list — its confirmation is the dialog
    pulling: (id: string) => replacing.busy(id),
    takeJira: (id: string, key: string) => void replacing.ask(id, key),
    replaceDialog: replacing.dialog,
  };
}

// ponytail: only validated tests live in Tests, so « Open in the editor » of a test still in review opens Review's
// editor in place — asked once, taken by Review when that test shows
const editAsked = new Set<string>();

export function openInEditor(navigate: (screen: Screen, arg?: string) => void, id: string, awaiting: boolean): void {
  if (!awaiting) {
    navigate("tests", id);
    return;
  }
  editAsked.add(id);
  navigate("review", id);
}

export const takeEditAsk = (id: string): boolean => editAsked.delete(id);
