import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnModes, Step, Test } from "../../../../core/types.ts";
import type { AppState } from "../../../lib/app.ts";
import { blankStep } from "../../../lib/blocks.ts";
import { discardAutosave } from "../../../lib/data/autosave.ts";
import { run } from "../../../lib/data/client.ts";
import { execute, invalidate, key, read } from "../../../lib/data/query.ts";
import { openExternal } from "../../../lib/desktop.ts";
import { differs } from "../../../lib/diff.ts";
import { message } from "../../../lib/format.ts";
import { editedAfterRun } from "../../../lib/revert.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import type { Dialog } from "../TestEditor.tsx";
import type { RemoteCheck } from "./SummaryCard.tsx";
import type { TestDocument } from "./useTestDocument.ts";

type Marks = { runId: string; byUid: Map<number, "changed" | "added"> } | null;

// ponytail: what the editor's buttons and menu do — each one command (or a job) of the registry, the pending autosave
// sent or dropped first as the command needs, the reads it changes read again by the data layer
export function useEditorActions({
  client,
  app,
  testId,
  test,
  doc,
  marks,
  refuseWhileClaude,
  setMarks,
  setDialog,
  setBusyDl,
  setCheckOverride,
  setPushing,
  onOpen,
  current,
}: {
  client: QueryClient;
  app: AppState;
  testId: string;
  test: Test | null;
  doc: TestDocument;
  marks: Marks;
  refuseWhileClaude: () => boolean;
  setMarks: (m: Marks) => void;
  setDialog: (d: Dialog | null) => void;
  setBusyDl: (b: boolean) => void;
  setCheckOverride: (c: RemoteCheck) => void;
  setPushing: (p: boolean) => void;
  onOpen: (id: string) => void;
  /** the test the editor shows now */
  current: () => string;
}) {
  const [revertConflict, setRevertConflict] = useState<string | null>(null);
  const docKey = key("tests.show", { id: testId });

  const steps = ({ setFocusStep }: { setFocusStep: (fn: number | ((f: number) => number)) => void; focus: number }) => ({
    move: (i: number, dir: -1 | 1) => {
      const j = i + dir;
      const all = test?.steps ?? [];
      if (j < 0 || j >= all.length) return;
      doc.update((t) => {
        const a = t.steps.slice();
        [a[i], a[j]] = [a[j], a[i]];
        return { ...t, steps: a };
      });
      setFocusStep(j);
      requestAnimationFrame(() =>
        (
          document.querySelector(`[data-step="${j}"] textarea, [data-step="${j}"] input`) as HTMLElement | null
        )?.focus(),
      );
    },
    insert: (at: number) => {
      doc.update((t) => {
        const a = t.steps.slice();
        a.splice(at, 0, blankStep());
        return { ...t, steps: a };
      });
      setFocusStep(at);
    },
    remove: (i: number, ok: () => boolean) => {
      const removed = test?.steps[i];
      if (!removed) return;
      const left = (test?.steps.length ?? 1) - 1;
      doc.update((t) => ({ ...t, steps: t.steps.filter((_, k) => k !== i) }));
      // ponytail: the ring moves to the step that takes the deleted one's place (Xray Editor)
      setFocusStep((f) => (f < 0 ? f : Math.min(f, Math.max(left - 1, 0))));
      toast({
        kind: "info",
        title: `Step ${i + 1} deleted`,
        action: {
          label: "Undo",
          run: () => {
            if (!ok()) {
              toast({ kind: "info", title: "Too late to undo", detail: "The test was reloaded since." });
              return;
            }
            doc.update((t) => ({ ...t, steps: [...t.steps.slice(0, i), removed as Step, ...t.steps.slice(i)] }));
          },
        },
      });
    },
    reorder: (from: number, to: number) =>
      doc.update((t) => {
        const a = t.steps.slice();
        const [moved] = a.splice(from, 1);
        a.splice(from < to ? to - 1 : to, 0, moved);
        return { ...t, steps: a };
      }),
  });

  const download = async () => {
    const k = test?.key;
    // ponytail: a run may have started while the dialog was open — checked again on confirm (Xray Editor)
    if (!k || refuseWhileClaude()) return setDialog(null);
    setBusyDl(true);
    try {
      discardAutosave(docKey);
      const r = await run<{ pulled: string[]; failed: { key: string; error: string }[] }>("xray.pull", {
        key: k,
        overwrite: true,
      });
      if (r.failed?.length) throw new Error(r.failed[0].error);
      app.testsChanged();
      // ponytail: the editor may show another test by now — that one stays as it is
      if (current() === testId) {
        await doc.reload("download");
        setCheckOverride("unchanged");
      }
      toast({ kind: "ok", title: `${k} refreshed from Jira` });
    } catch (e) {
      errorToast(e, `Could not download ${k}`);
    } finally {
      setBusyDl(false);
      setDialog(null);
    }
  };

  const askDownload = async () => {
    if (refuseWhileClaude() || !test?.key) return;
    await doc.doc.flush();
    try {
      await invalidate(client, [["tests.show", { id: testId }]]);
      const r = (await read(client, "tests.show", { id: testId })) as { test: Test; remote?: Test | null };
      const local = r.remote ? differs(r.test, r.remote) : true;
      if (local) setDialog({ kind: "download" });
      else void download();
    } catch (e) {
      errorToast(e, "Could not read the test");
    }
  };

  const undoLocal = async () => {
    if (refuseWhileClaude()) return setDialog(null);
    try {
      discardAutosave(docKey);
      await execute(client, "tests.restore", { id: testId }, {
        invalidates: [["tests.list"], ["review.queue"], ["project.info"]],
      });
      await doc.reload("undo");
      app.testsChanged();
      toast({ kind: "ok", title: "Restored the Jira version", detail: "From the last sync — nothing was downloaded." });
    } catch (e) {
      errorToast(e, "Could not undo the local changes");
    } finally {
      setDialog(null);
    }
  };

  const openInJira = async (k: string) => {
    try {
      const { url } = (await read(client, "xray.browse", { key: k })) as { url: string };
      if (!openExternal(url)) window.open(url, "_blank", "noopener");
    } catch (e) {
      errorToast(e, `Could not open ${k}`);
    }
  };

  const clone = async () => {
    await doc.doc.flush();
    try {
      const r = (await execute(client, "tests.clone", { id: testId }, { invalidates: [["tests.list"], ["project.info"]] })) as {
        id: string;
      };
      app.testsChanged();
      onOpen(r.id);
      toast({ kind: "ok", title: "Cloned", detail: "The copy is a new local test." });
    } catch (e) {
      errorToast(e, "Could not clone the test");
    }
  };

  const askDelete = async () => {
    if (refuseWhileClaude() || !test) return;
    await doc.doc.flush();
    // ponytail: from the editor's menu it always asks (Xray Editor); the sidebar's ✕ asks only when it matters
    setDialog({ kind: "delete" });
  };

  const askUndo = () => !refuseWhileClaude() && setDialog({ kind: "undo" });

  const askPush = async () => {
    if (refuseWhileClaude()) return;
    await doc.doc.flush();
    setPushing(true);
  };

  const pushClosed = () => {
    setPushing(false);
    void doc
      .reload("push")
      .then(() => app.testsChanged())
      .catch(() => {});
  };

  const pushDone = (id: string) => {
    setPushing(false);
    app.testsChanged();
    if (id !== testId) onOpen(id);
    else void doc.reload("push").catch((e) => errorToast(e, "Could not reload the test"));
  };

  const revertClaude = async (force = false) => {
    if (!marks) return;
    try {
      // ponytail: a pending edit is saved before the revert reads the file (Xray Editor)
      await doc.doc.flush();
      const r = (await execute(
        client,
        "claude.revert",
        force ? { runId: marks.runId, force: true } : { runId: marks.runId },
        { invalidates: "none" },
      )) as { reverted?: string[] };
      setRevertConflict(null);
      app.setLastRun({
        runId: "",
        changedTests: r.reverted?.length ? r.reverted : [testId],
        changedSteps: {},
        nonce: Date.now(),
      });
      app.testsChanged();
      toast({ kind: "info", title: "Claude's changes reverted" });
    } catch (e) {
      if (!force && editedAfterRun(e)) setRevertConflict(message(e));
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  const setTestContexts = async (ids: string[] | null) => {
    try {
      const r = await execute(
        client,
        "contexts.setTest",
        { testId, contexts: ids },
        { invalidates: [["contexts.ofTest", { testId }], ["contexts.ofProject"]] },
      );
      client.setQueryData(key("contexts.ofTest", { testId }), r);
    } catch (e) {
      errorToast(e, "Could not change the contexts of this test");
    }
  };

  const setProjectModes = async (modes: ColumnModes) => {
    try {
      await execute(client, "columns.setModes", { modes }, { invalidates: [["project.info"], ["columns.list"]] });
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Could not save the column settings");
    }
  };

  const setTestModes = async (modes: ColumnModes | null) => {
    try {
      const r = await execute(client, "tests.setColumns", { id: testId, modes }, { invalidates: "none" });
      client.setQueryData(key("tests.columns", { id: testId }), r);
    } catch (e) {
      errorToast(e, "Could not save the column settings of this test");
    }
  };

  const imageGone = (file: string) => {
    void doc.doc
      .flush()
      .then(() => execute(client, "tests.removeImage", { id: testId, file }, { invalidates: [["tests.show", { id: testId }]] }))
      .catch(() => {});
  };

  return {
    steps,
    download,
    askDownload,
    undoLocal,
    askUndo,
    openInJira,
    clone,
    askDelete,
    askPush,
    pushClosed,
    pushDone,
    revertClaude,
    revertConflict,
    setRevertConflict,
    setTestContexts,
    setProjectModes,
    setTestModes,
    imageGone,
    clearMarks: () => setMarks(null),
  };
}

export type EditorActions = ReturnType<typeof useEditorActions>;
