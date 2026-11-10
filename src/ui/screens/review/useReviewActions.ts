import { useState } from "react";
import type { RunPick } from "../../components/claude/pieces.ts";
import type { AppState } from "../../lib/app.ts";
import { useCommand } from "../../lib/data/query.ts";
import { editedAfterRun, revertDone } from "../../lib/revert.ts";
import { errorToast } from "../../lib/toast.ts";
import type { QueueItem } from "./ReviewQueue.tsx";
import type { Loaded, useDecisions } from "./useReview.ts";
import type { useReviewView } from "./useReviewView.ts";

type Args = {
  app: AppState;
  data: Loaded | null;
  items: QueueItem[] | null;
  act: ReturnType<typeof useDecisions>;
  view: ReturnType<typeof useReviewView>;
  running: boolean;
};

// ponytail: what the reviewer decides on the open test — one decision at a time; To fix with Claude is the review.fix
// run in the dock (it marks the test itself); Revert undoes Claude's last run, and asks before dropping later edits
export function useReviewActions({ app, data, items, act, view, running }: Args) {
  const [busy, setBusy] = useState(false);
  const [revertConflict, setRevertConflict] = useState<string | null>(null);
  const revert = useCommand("claude.revert", { flushFirst: [["tests.show"]] });
  const label = data ? (data.test.key ?? data.test.summary) : "";

  const decide = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const askFix = (note?: string, run: RunPick = {}) => {
    if (!data) return;
    const text = note ?? data.test.reviewNote ?? "";
    void act.flush(data.id).then(() =>
      app.runInDock({
        name: "review.fix",
        input: { id: data.id, ...(note ? { note } : {}), ...run },
        label: text || "Fix the test",
        testId: data.id,
      }),
    );
  };

  const undo = async (force = false) => {
    if (!view.marks) return;
    try {
      const runId = view.marks.runId;
      const r = (await revert.mutateAsync(force ? { runId, force: true } : { runId })) as {
        reverted?: string[];
        files?: string[];
      };
      setRevertConflict(null);
      view.patch({ marks: null });
      revertDone(app, runId, r);
    } catch (e) {
      if (!force && (editedAfterRun(e) || (e as { code?: string }).code === "edited-after-run"))
        setRevertConflict(e instanceof Error ? e.message : String(e));
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  return {
    busy,
    revertConflict,
    keepAfterRun: () => setRevertConflict(null),
    validate: () => {
      if (!data || view.fixOpen || running) return;
      void decide(() => act.validate(data.id, label, items ?? []));
    },
    markToFix: (note: string, askClaude: boolean, run?: RunPick) => {
      if (!data) return;
      view.patch({ fixOpen: false });
      if (askClaude) askFix(note, run);
      else void decide(() => act.markToFix(data.id, label, items ?? [], note));
    },
    askFix: () => askFix(),
    toDraft: () => {
      if (!data || running) return;
      void decide(() => act.toDraft(data.id, label));
    },
    undo: (force?: boolean) => void undo(force),
  };
}
