import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ColumnModes, Folder, LocalTestRef, Precondition, Step, StepImage, Test } from "../../../core/types.ts";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { columnsOf, projectModes } from "../../lib/columns.ts";
import { pendingAutosaves } from "../../lib/data/autosave.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { invalidate, key, useRead } from "../../lib/data/query.ts";
import { differs, diffLocal, type Gone, lossOf, restoreStep } from "../../lib/diff.ts";
import { DEFAULT_LAYOUT } from "../../lib/fields.ts";
import { uploadImage } from "../../lib/files.ts";
import { message } from "../../lib/format.ts";
import { addedSteps } from "../../lib/marks.ts";
import { usePref } from "../../lib/prefs.ts";
import { takeJump } from "../../lib/search.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { DeleteTest } from "./DeleteTest.tsx";
import { DownloadConfirm, RestoreConfirm, UndoConfirm } from "./editor/Confirms.tsx";
import { EditorBanners } from "./editor/EditorBanners.tsx";
import { EditorBar } from "./editor/EditorBar.tsx";
import { EditorColumn } from "./editor/EditorColumn.tsx";
import { PreconditionList } from "./editor/PreconditionList.tsx";
import { StepList } from "./editor/StepList.tsx";
import { type RemoteCheck, SummaryCard } from "./editor/SummaryCard.tsx";
import { type ContextRef, type TestContexts, TestDetails } from "./editor/TestDetails.tsx";
import { pushReason, testMenu } from "./editor/testMenu.ts";
import { useEditorActions } from "./editor/useEditorActions.ts";
import { useStepUids } from "./editor/useStepUids.ts";
import { type TestShow, useTestDocument } from "./editor/useTestDocument.ts";
import { Lightbox } from "./Lightbox.tsx";
import { PushDialog } from "./PushDialog.tsx";
import type { StepLayout } from "./StepCard.tsx";

export type { TestShow };

const styles = stylex.create({
  editor: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.canvas,
  },
  empty: { boxSizing: "border-box", padding: space.s7, display: "flex", flexDirection: "column", gap: space.s4 },
});

type Mark = "changed" | "added";
type Run = { run: { runId: string; changedSteps: Record<string, number[]> }; before?: number };
export type Dialog =
  | { kind: "download" }
  | { kind: "undo" }
  | { kind: "delete" }
  | { kind: "restore"; base: Step; gone: Gone | null; n: number }
  | { kind: "contexts" };

const flatten = (f: Folder): string[] => [f.path, ...f.folders.flatMap(flatten)];

function showStep(i: number) {
  const el = document.querySelector(`[data-step="${i}"]`);
  el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

export function TestEditor({
  testId,
  onSaved,
  onOpen,
  lead,
  onBack,
}: {
  testId: string;
  onSaved: (ref: Partial<LocalTestRef> & { id: string }) => void;
  onOpen: (id: string) => void;
  /** before the key in the bar (the list toggle of a narrow window) */
  lead?: React.ReactNode;
  /** opened from Review: the bar leads back there instead of offering folder, push and ⋯ */
  onBack?: () => void;
}) {
  const app = useApp();
  const client = useQueryClient();
  const jiraKey = app.info?.project.jiraOffline ? "" : (app.info?.project.jiraProject ?? "");
  const xray = app.xray ?? DEFAULT_LAYOUT;
  // ponytail: any Claude run locks the editor (Xray Editor) — a project run may write this test.md too
  const busy = !!app.claudeRunning;
  const busyHere = app.claudeRunning === testId;
  const uids = useStepUids();
  const [marks, setMarks] = useState<{ runId: string; byUid: Map<number, Mark> } | null>(null);
  const docKey = JSON.stringify(key("tests.show", { id: testId }));

  const doc = useTestDocument(testId, {
    readOnly: busy,
    onSaved,
    onLanded: (data, { first, expected }) => {
      if (first) {
        const found = takeJump(testId);
        if (found) setTimeout(() => showStep(found - 1), 60);
      }
      const run = expected as Run | undefined;
      if (run && typeof run === "object" && "run" in run) {
        const nums = run.run.changedSteps[testId] ?? [];
        if (!run.run.runId || !nums.length) return setMarks(null);
        const byUid = new Map<number, Mark>();
        const added = addedSteps(nums, run.before);
        for (const k of nums) {
          const s = data.test.steps[k - 1];
          if (s) byUid.set(uids.uidOf(s), added.has(k) ? "added" : "changed");
        }
        return setMarks({ runId: run.run.runId, byUid });
      }
      if (first) return;
      setMarks(null);
      if (expected === undefined && !pendingAutosaves().some((k) => JSON.stringify(k) === docKey)) {
        app.testsChanged();
        toast({
          kind: "info",
          title: "Reloaded from disk",
          detail: "test.md changed on disk — the editor shows it now.",
        });
      }
    },
  });
  const test = doc.test;
  const data = doc.data;
  const remote = data?.remote ?? null;
  const genRef = useRef(doc.gen);
  const idRef = useRef(testId);
  idRef.current = testId;
  genRef.current = doc.gen;

  const [layout, setLayout] = usePref("stepLayout");
  const [details, setDetails] = usePref("showDetails");
  const [width, setWidth] = usePref("editorWidth");
  const [focus, setFocusStep] = useState(-1);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [lb, setLb] = useState<{ images: StepImage[]; index: number; step: number; column?: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyDl, setBusyDl] = useState(false);
  const [checkOverride, setCheckOverride] = useState<RemoteCheck>(null);
  const [foldersAsked, setFoldersAsked] = useState(false);
  const [lastEdited, setLastEdited] = useState<number | "head">(-1);
  const shownFor = useRef(testId);
  // ponytail: another test in the same editor starts clean — no marks, folds, ring or dialog of the one before
  useEffect(() => {
    if (shownFor.current === testId) return;
    shownFor.current = testId;
    setMarks(null);
    setFolded(new Set());
    setFocusStep(-1);
    setDialog(null);
    setCheckOverride(null);
    setLastEdited(-1);
  }, [testId]);

  const preQ = useRead("xray.preconditions", {}, { enabled: !!jiraKey });
  const preconditions =
    !jiraKey || preQ.isError ? [] : preQ.isSuccess ? ((preQ.data as Precondition[] | null) ?? []) : null;
  const contextsQ = useRead("contexts.list", {});
  const contexts = ((contextsQ.data as ContextRef[] | null | undefined) ?? []) as ContextRef[];
  const ofTestQ = useRead("contexts.ofTest", { testId });
  const testCtx = (ofTestQ.data as TestContexts | undefined) ?? null;
  const colsQ = useRead("tests.folds", { id: testId });
  const testCols = ((colsQ.data as { own: ColumnModes | null } | undefined)?.own ?? null) as ColumnModes | null;
  const foldersQ = useRead("xray.folders", {}, { enabled: foldersAsked && !!jiraKey });
  const statusQ = useRead("xray.status", { id: testId }, { enabled: !!test?.key && !!remote && !checkOverride });

  useEffect(() => {
    if (preQ.error) errorToast(preQ.error, "Could not load the preconditions from Jira");
  }, [preQ.error]);
  useEffect(() => {
    if (foldersQ.error) errorToast(foldersQ.error, "Could not load the Xray folders");
  }, [foldersQ.error]);

  const status = (statusQ.data as { tests?: { id: string; sync: LocalTestRef["sync"]; remote: RemoteCheck }[] })
    ?.tests?.[0];
  const check: RemoteCheck =
    checkOverride ??
    (!test?.key || !remote
      ? null
      : statusQ.isFetching
        ? "checking"
        : statusQ.error
          ? "unverified"
          : (status?.remote ?? "unverified"));
  const sync = status?.sync ?? data?.sync ?? (test?.key ? "synced" : "local");
  useEffect(() => {
    if (status) onSaved({ id: testId, sync: status.sync });
  }, [status, testId, onSaved]);

  // ponytail: the user may have edited test.md in a terminal or with Claude Code — on window focus it is read again
  // (the event stream also says so); a pending edit is never overwritten: a change under it is a conflict
  useEffect(() => {
    const onFocusEvt = () => {
      if (busy) return;
      doc.recheck().catch((e) => errorToast(e, "Could not reload the test"));
    };
    window.addEventListener("focus", onFocusEvt);
    return () => window.removeEventListener("focus", onFocusEvt);
  }, [busy, doc.recheck]);

  const { setFocus } = app;
  useEffect(() => {
    if (!test) return;
    setFocus({ testId, key: test.key, summary: test.summary, step: focus >= 0 ? focus + 1 : null });
  }, [setFocus, testId, test, focus]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const lastRun = app.lastRun;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a run is consumed once, by its nonce
  useEffect(() => {
    // ponytail: a run on this test reloads it even when it reports no change (Xray Editor always reads the file back)
    if (!lastRun || !(lastRun.changedTests.includes(testId) || lastRun.testId === testId)) return;
    const before = test?.steps.length;
    doc
      .reload({ run: lastRun, before } satisfies Run)
      .catch((e) => errorToast(e, "Could not reload the test after Claude"));
  }, [lastRun?.nonce]);

  const alive = () => {
    const g = genRef.current;
    return () => genRef.current === g;
  };

  const refuseWhileClaude = () => {
    if (!busy) return false;
    toast({ kind: "info", title: "Wait for Claude to finish", detail: "This test is being edited right now." });
    return true;
  };

  const actions = useEditorActions({
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
    current: () => idRef.current,
  });

  if (doc.error)
    return (
      <div {...stylex.props(styles.editor)}>
        {lead}
        <div {...stylex.props(styles.empty)}>
          <Banner
            tone="danger"
            title="This test could not be opened"
            actions={
              <>
                <Button size="sm" label="Try again" onClick={() => void doc.recheck().catch(() => {})} />
                {onBack && <Button size="sm" icon="arrow-left" label="Back to review" onClick={onBack} />}
              </>
            }
          >
            {message(doc.error)}
          </Banner>
        </div>
      </div>
    );

  if (!test || !data)
    return (
      <div role="status" aria-busy="true" aria-label="Loading the test" {...stylex.props(styles.editor)}>
        {lead}
        <div {...stylex.props(styles.empty)}>
          <Skeleton kind="title" width="70%" />
          <Skeleton lines={2} />
          <Skeleton kind="block" />
          <Skeleton kind="block" />
        </div>
      </div>
    );

  uids.carry(test.steps);
  const url = (file: string) => fileUrl(`tests/${testId}/${file}`);
  const files = new Set(data.files ?? []);
  const dirty = remote ? differs(test, remote) : !test.key;
  const diff = remote && dirty ? diffLocal(test.steps, remote.steps) : null;
  const pModes = projectModes(xray);
  const linked = !!jiraKey && !!xray.fetchedAt;
  const cols = columnsOf(
    xray,
    { fields: Object.fromEntries(test.steps.flatMap((s) => Object.entries(s.fields))), sources: [], images: [] },
    linked,
  );
  // ponytail: nothing local to send — the test matches its last sync, even if Jira changed since (Xray Editor)
  const canPush = !(!!remote && !!test.key && !dirty);
  const pushDisabled = pushReason({ busy, jiraOff: !jiraKey, pushing, canPush, unsaved: doc.doc.status });
  const markOf = (s: Step) => marks?.byUid.get(uids.uidOf(s));
  const marked = marks ? test.steps.flatMap((s, i) => (markOf(s) ? [{ i, added: markOf(s) === "added" }] : [])) : null;
  const update = (fn: (t: Test) => Test) => {
    setLastEdited("head");
    doc.update(fn);
  };
  const patchByUid = (uid: number, fn: (s: Step) => Step) => {
    setLastEdited(uid);
    setMarks((m) => (m?.byUid.has(uid) ? { ...m, byUid: new Map([...m.byUid].filter(([k]) => k !== uid)) } : m));
    doc.update((t) => ({
      ...t,
      steps: t.steps.map((s) => {
        if (uids.uidOf(s) !== uid) return s;
        const next = fn(s);
        uids.keep(s, next);
        return next;
      }),
    }));
  };
  const steps = actions.steps({ setFocusStep, focus });
  const folders = [
    ...new Set([
      ...flatten((foldersQ.data as Folder | undefined) ?? ({ path: "/", folders: [] } as unknown as Folder)),
      ...(app.info?.project.folders ?? []),
    ]),
  ].sort();
  // ponytail: the bar says how the test is saved; a field says it only when its edit could not be saved (Retry there)
  const fieldSave = doc.doc.status === "error" ? doc.doc : undefined;
  const restoreMissing = dialog?.kind === "restore" ? dialog.base.images.filter((im) => !files.has(im.file)).length : 0;

  return (
    <div {...stylex.props(styles.editor)}>
      <EditorBar
        lead={lead}
        testKey={test.key}
        folder={test.folder}
        folders={folders}
        status={doc.doc.status}
        activity={busyDl ? "Refreshing from Jira…" : undefined}
        claude={busy}
        pushDisabled={pushDisabled}
        menu={testMenu({ test, remote, dirty, busyDl, actions })}
        onFolders={() => {
          setFoldersAsked(true);
          if (foldersQ.isError) void foldersQ.refetch();
        }}
        onFolder={(f) => update((t) => ({ ...t, folder: f }))}
        onRetry={() => void doc.doc.retry()}
        onAsk={() => app.askClaude("test")}
        onPush={() => void actions.askPush()}
        onBack={onBack}
      />
      <EditorColumn
        width={width}
        onWidth={setWidth}
        inert={busy}
        top={
          <EditorBanners
            busy={busy}
            busyHere={busyHere}
            marked={marked}
            conflict={doc.doc.status === "conflict"}
            revertConflict={actions.revertConflict}
            onShowChanges={() => {
              const first = test.steps.findIndex((s) => markOf(s));
              if (first >= 0) showStep(first);
            }}
            onRevert={() => void actions.revertClaude()}
            onForceRevert={() => void actions.revertClaude(true)}
            onKeepRevert={() => actions.setRevertConflict(null)}
            onReloadDisk={() => doc.doc.takeDisk()}
            onKeepMine={() => void doc.doc.keepMine()}
          />
        }
      >
        <SummaryCard
          test={test}
          sync={sync}
          edited={data.edited}
          dirty={dirty}
          remote={check}
          readOnly={busy}
          saveState={lastEdited === "head" ? fieldSave : undefined}
          details={details}
          onDetails={setDetails}
          onRemote={() => void actions.askDownload()}
          update={update}
        >
          <TestDetails
            test={test}
            readOnly={busy}
            saveState={lastEdited === "head" ? fieldSave : undefined}
            preconditions={preconditions}
            contexts={contexts}
            testContexts={testCtx}
            update={update}
            onContexts={(ids) => void actions.setTestContexts(ids)}
            onManageContexts={() => setDialog({ kind: "contexts" })}
          />
        </SummaryCard>
        {test.preconditions.length > 0 && (
          <PreconditionList
            keys={test.preconditions}
            known={preconditions}
            onOpen={(k) => void actions.openInJira(k)}
          />
        )}
        <StepList
          test={test}
          testId={testId}
          xray={xray}
          linked={linked}
          layout={layout as StepLayout}
          projectModes={pModes}
          testModes={testCols}
          columns={cols}
          gone={diff?.gone ?? []}
          readOnly={busy}
          focus={focus}
          folded={folded}
          saveState={fieldSave}
          savedUid={typeof lastEdited === "number" ? lastEdited : -1}
          uidOf={uids.uidOf}
          markOf={(s, i) => {
            const dm = diff?.marks[i];
            return {
              claude: markOf(s),
              diff: dm,
              before: dm === "modified" ? remote?.steps.find((b) => b.id === s.id) : undefined,
            };
          }}
          url={url}
          addImage={(f) => uploadImage(testId, f)}
          alive={alive}
          onLayout={setLayout}
          onProjectModes={(m) => void actions.setProjectModes(m)}
          onTestModes={(m) => void actions.setTestModes(m)}
          onPatch={patchByUid}
          onFold={(uid, v) =>
            setFolded((cur) => {
              const next = new Set(cur);
              if (v) next.add(uid);
              else next.delete(uid);
              return next;
            })
          }
          onFocus={setFocusStep}
          onMove={steps.move}
          onInsert={steps.insert}
          onDelete={(i) => steps.remove(i, alive())}
          onReorder={steps.reorder}
          onAsk={(i) => {
            setFocusStep(i);
            setFocus({ testId, key: test.key, summary: test.summary, step: i + 1 });
            app.askClaude("step");
          }}
          onDraft={() =>
            app.askClaude("test", "Draft the steps of this test from its description and the documents it cites.")
          }
          onRestore={(base, gone, n) => !refuseWhileClaude() && setDialog({ kind: "restore", base, gone, n })}
          onOpenImage={(file, images, step, column) =>
            setLb({
              images,
              step,
              column,
              index: Math.max(
                0,
                images.findIndex((im) => im.file === file),
              ),
            })
          }
          onOpenSource={app.openSource}
          onImageGone={actions.imageGone}
        />
      </EditorColumn>
      {pushing && (
        <PushDialog
          testId={testId}
          testKey={test.key}
          summary={test.summary}
          review={test.review}
          onClose={actions.pushClosed}
          onDone={actions.pushDone}
        />
      )}
      {lb && lb.images.length > 0 && (
        <Lightbox
          names={lb.images.map((im) => im.file.split("/").pop() ?? im.file)}
          urls={lb.images.map((im) => url(im.file))}
          index={Math.min(lb.index, lb.images.length - 1)}
          step={lb.step}
          column={lb.column}
          onIndex={(index) => setLb({ ...lb, index })}
          onClose={() => setLb(null)}
        />
      )}
      {dialog?.kind === "download" && test.key && (
        <DownloadConfirm
          testKey={test.key}
          synced={!!remote}
          loss={remote ? lossOf(test, remote) : undefined}
          modifiedSteps={diff?.marks.flatMap((m, i) => (m === "modified" ? [i + 1] : [])) ?? []}
          busy={busyDl}
          onConfirm={actions.download}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "undo" && remote && (
        <UndoConfirm loss={lossOf(test, remote)} onConfirm={actions.undoLocal} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "restore" && (
        <RestoreConfirm
          gone={!!dialog.gone}
          n={dialog.n}
          missing={restoreMissing}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const d = dialog;
            setDialog(null);
            if (refuseWhileClaude()) return;
            update((t) => restoreStep(t, d.base, d.gone));
            toast({
              kind: "ok",
              title: d.gone ? "Deleted step restored" : `Step ${d.n} restored from Jira`,
              detail: "From the last sync — nothing was downloaded.",
            });
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteTest
          target={{
            id: testId,
            key: test.key,
            summary: test.summary,
            synced: !!remote,
            dirty,
            loss: remote && dirty ? lossOf(test, remote) : undefined,
          }}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            app.testsChanged();
            app.navigate("tests");
          }}
        />
      )}
      {dialog?.kind === "contexts" && (
        <ContextsDialog
          onClose={() => {
            setDialog(null);
            void invalidate(client, [["contexts.list"], ["contexts.ofTest"], ["contexts.ofProject"]]);
          }}
        />
      )}
    </div>
  );
}
