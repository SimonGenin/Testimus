import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ColumnModes, Folder, LocalTestRef, Precondition, Step, StepImage, Test } from "../../../core/types.ts";
import { useRunContext } from "../../components/claude/useRunContext.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { useSideTab } from "../../components/ui/workspace/useSideTab.tsx";
import { useApp } from "../../lib/app.ts";
import { columnsOf, projectModes } from "../../lib/columns.ts";
import { pendingAutosaves } from "../../lib/data/autosave.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { differs, diffLocal, diffRun, type Gone, lossOf, restoreRunStep, restoreStep } from "../../lib/diff.ts";
import { DEFAULT_LAYOUT } from "../../lib/fields.ts";
import { uploadImage } from "../../lib/files.ts";
import { message } from "../../lib/format.ts";
import { addedSteps } from "../../lib/marks.ts";
import { usePref } from "../../lib/prefs.ts";
import { takeJump } from "../../lib/search.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { AnalysisPane } from "./analysis/AnalysisPane.tsx";
import { useAnalysis } from "./analysis/useAnalysis.ts";
import { type DeleteTarget, DeleteTest } from "./DeleteTest.tsx";
import { CommentsCard } from "./editor/CommentsCard.tsx";
import { RestoreConfirm, UndoConfirm } from "./editor/Confirms.tsx";
import { DetailsCard, restoreDetails } from "./editor/DetailsCard.tsx";
import { EditorBanners } from "./editor/EditorBanners.tsx";
import { EditorBar } from "./editor/EditorBar.tsx";
import { EditorColumn } from "./editor/EditorColumn.tsx";
import { EditorLoading } from "./editor/EditorLoading.tsx";
import { JiraChanged } from "./editor/JiraChanged.tsx";
import { JiraControls, JiraOff } from "./editor/JiraControls.tsx";
import { PreconditionList } from "./editor/PreconditionList.tsx";
import { StepList } from "./editor/StepList.tsx";
import { type RemoteCheck, SummaryCard } from "./editor/SummaryCard.tsx";
import { type ContextRef, type TestContexts, TestDetails } from "./editor/TestDetails.tsx";
import { pushReason, testMenu } from "./editor/testMenu.ts";
import { useEditorActions } from "./editor/useEditorActions.ts";
import { useStepUids } from "./editor/useStepUids.ts";
import { type TestShow, useTestDocument } from "./editor/useTestDocument.ts";
import { Lightbox } from "./Lightbox.tsx";
import { claudeLock } from "./lock.ts";
import { PushDialog } from "./PushDialog.tsx";
import type { StepLayout } from "./StepCard.tsx";
import type { WasFrom } from "./step/WasToggle.tsx";

export type { TestShow };

const styles = stylex.create({
  split: { flex: 1, minWidth: 0, minHeight: 0, display: "flex" },
  editor: {
    flex: 1,
    minWidth: size.sidebar,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.canvas,
  },
  empty: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: space.s7,
  },
});

type Mark = "changed" | "added";
type Run = { run: { runId: string; changedSteps: Record<string, number[]> }; before?: number };
export type Dialog =
  | { kind: "undo" }
  | { kind: "delete"; target: DeleteTarget }
  | { kind: "restore"; base: Step; gone: Gone | null; n: number; from: WasFrom };

const flatten = (f: Folder): string[] => [f.path, ...f.folders.flatMap(flatten)];

function showStep(i: number) {
  const el = document.querySelector(`[data-step="${i}"]`);
  el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

export function TestEditor({
  testId,
  onSaved,
  onOpen,
  onBack,
}: {
  testId: string;
  onSaved: (ref: Partial<LocalTestRef> & { id: string }) => void;
  onOpen: (id: string) => void;
  /** opened from Review (the top bar leads back there): the bar says « Editing » instead of offering folder, push and ⋯ */
  onBack?: () => void;
}) {
  const app = useApp();
  const client = useQueryClient();
  const jiraKey = app.info?.project.jiraOffline ? "" : (app.info?.project.jiraProject ?? "");
  const xray = app.xray ?? DEFAULT_LAYOUT;
  // ponytail: any Claude run locks the editor (Xray Editor) — a project run may write this test.md too; the reason says
  // whose run it is
  const busy = !!app.claudeRunning;
  const busyHere = app.claudeRunning === testId;
  const locked = claudeLock(app.claudeRunning, testId, true);
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
          tone: "neutral",
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
  const claudeQ = useRead("claude.before", { testId });
  const commentsQ = useRead("issue.comments", { key: test?.key ?? "" }, { enabled: !!test?.key && !!jiraKey });

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

  // ponytail: the gestures are disabled with the reason while Claude runs; a run that started since is still refused
  const refuseWhileClaude = () => {
    if (!locked) return false;
    toast({ tone: "neutral", title: "Wait for Claude to finish", detail: locked });
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
    setCheckOverride,
    setPushing,
    onOpen,
    onDeleted: () => {
      setDialog(null);
      app.testsChanged();
      app.navigate("tests");
    },
    current: () => idRef.current,
  });
  const busyDl = actions.downloading;
  // ponytail: the test's own list of saved contexts is ticked in the same graph a run on this test would show — and
  // like the rest of the head, not while Claude works
  const given = useRunContext({
    use: "ask-test",
    scope: { kind: "test", testId },
    standing: {
      says: "every run on this test",
      onChange: (ids) => actions.setTestContexts(ids),
      locked: locked || undefined,
    },
  });
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const analysis = useAnalysis(testId, {
    save: () => doc.doc.saveNow(),
    expect: () => doc.expect("analysis"),
    reload: () => doc.reload("analysis"),
  });
  const toDecide = analysis.analysis?.proposals.filter((p) => p.state === "open").length ?? 0;
  // ponytail: the cross-check (its analysis) is a tab of the screen's sections, beside the test (never over it); it stays the editor's
  const analysisTab = useSideTab(
    {
      id: "analysis",
      label: "Cross-check",
      icon: "verify",
      claude: true,
      ...(toDecide ? { count: toDecide } : {}),
      ...(analysis.running ? { dot: "claude" as const } : {}),
    },
    analysisOpen || !!analysis.running,
    test && (
      <AnalysisPane
        testId={testId}
        test={test}
        state={analysis}
        defaults={app.info?.project.claude ?? { model: "sonnet", effort: "medium" }}
        locked={locked}
        onSelect={(p) => {
          if (p.now) showStep(p.kind === "step" ? Math.max(p.now - 1, 0) : p.now - 1);
        }}
        onOpenSource={app.openSource}
        onClose={() => setAnalysisOpen(false)}
      />
    ),
  );

  if (doc.error)
    return (
      <div {...stylex.props(styles.editor)}>
        <div {...stylex.props(styles.empty)}>
          <EmptyState
            icon="alert-circle"
            title="This test could not be opened"
            text={message(doc.error)}
            actions={
              <>
                <Button icon="refresh" label="Try again" onClick={() => void doc.recheck().catch(() => {})} />
                {onBack && <Button icon="arrow-left" label="Back to review" onClick={onBack} />}
              </>
            }
          />
        </div>
      </div>
    );

  if (!test || !data) return <EditorLoading />;

  uids.carry(test.steps);
  const url = (file: string) => fileUrl(`tests/${testId}/${file}`);
  const files = new Set(data.files ?? []);
  const dirty = remote ? differs(test, remote) : !test.key;
  const diff = remote && dirty ? diffLocal(test.steps, remote.steps) : null;
  // ponytail: the test before the Claude run that changed it, while that change stands — each step it changed can be
  // seen as it was, as Jira's version is; the steps are « Claude's » only while the test is as the run left it
  const claudeRun = claudeQ.data ?? null;
  const cdiff = claudeRun ? diffRun(test.steps, claudeRun.test.steps) : null;
  const jiraGone = new Set((diff?.gone ?? []).flatMap((g) => (g.step.id ? [g.step.id] : [])));
  const gone = [
    ...(diff?.gone ?? []),
    ...(cdiff?.gone ?? [])
      .filter((g) => !g.step.id || !jiraGone.has(g.step.id))
      .map((g) => ({ ...g, from: "claude" as const })),
  ];
  const pModes = projectModes(xray);
  const linked = !!jiraKey && !!xray.fetchedAt;
  const cols = columnsOf(
    xray,
    { fields: Object.fromEntries(test.steps.flatMap((s) => Object.entries(s.fields))), sources: [], images: [] },
    linked,
  );
  // ponytail: nothing local to send — the test matches its last sync, even if Jira changed since (Xray Editor)
  const canPush = !(!!remote && !!test.key && !dirty);
  const pushDisabled = pushReason({ busy: locked, jiraOff: !jiraKey, pushing, canPush, unsaved: doc.doc.status });
  // ponytail: Compare shows what is yours — the first step that differs from the last sync, else the test's head
  const compare = () => {
    const first = diff?.marks.findIndex((m) => !!m) ?? -1;
    if (first >= 0) showStep(first);
    else document.querySelector('[aria-label="Test"]')?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
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
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.editor)}>
        <EditorBar
          testKey={test.key}
          folder={test.folder}
          folders={folders}
          status={doc.doc.status}
          activity={busyDl ? "Refreshing from Jira…" : undefined}
          claude={locked}
          pushDisabled={pushDisabled}
          menu={testMenu({ test, remote, dirty, busyDl, locked, actions })}
          onFolders={() => {
            setFoldersAsked(true);
            if (foldersQ.isError) void foldersQ.refetch();
          }}
          onFolder={(f) => update((t) => ({ ...t, folder: f }))}
          onRetry={() => void doc.doc.retry()}
          onAsk={() => app.askClaude("test")}
          analysis={{
            open: analysisOpen || !!analysis.running,
            count: toDecide,
            onToggle: () => {
              if (analysisOpen && !analysisTab.shown) analysisTab.reveal();
              else setAnalysisOpen((o) => !o);
            },
          }}
          onPush={() => void actions.askPush()}
          editing={!!onBack}
        />
        <EditorColumn
          width={width}
          onWidth={setWidth}
          inert={busy}
          top={
            <>
              {check === "remote-changed" && !onBack && test.key && (
                <JiraChanged
                  replacing={busyDl}
                  locked={locked}
                  keepOff={pushDisabled}
                  onCompare={compare}
                  onReplace={actions.askDownload}
                  onKeepMine={() => void actions.askPush()}
                />
              )}
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
            </>
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
            jira={
              test.key && jiraKey ? (
                <JiraControls
                  testKey={test.key}
                  status={test.status}
                  assignee={test.assignee}
                  assigneeId={test.assigneeId}
                  readOnly={locked}
                  comments={commentsQ.data ? commentsQ.data.comments.length : null}
                  onComments={() =>
                    document.getElementById("jira-comments")?.scrollIntoView?.({ behavior: "smooth", block: "start" })
                  }
                />
              ) : (
                <JiraOff local={!test.key} status={test.status} assignee={test.assignee} assigneeId={test.assigneeId} />
              )
            }
            onOpenKey={(k) => void actions.openInJira(k)}
            update={update}
          />
          <DetailsCard
            test={test}
            remote={remote}
            before={claudeRun?.test ?? null}
            open={details}
            readOnly={busy}
            onOpen={setDetails}
            onRestore={(from, was, fields) => {
              if (refuseWhileClaude()) return;
              update((t) => restoreDetails(t, was, fields));
              toast({
                tone: "success",
                title: from === "claude" ? "Details put back as before Claude" : "Details back to Jira's version",
                detail:
                  from === "claude"
                    ? "As the test was before Claude's run."
                    : "From the last sync — nothing was downloaded.",
              });
            }}
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
              onContext={given.context.onOpen}
            />
          </DetailsCard>
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
            gone={gone}
            readOnly={busy}
            focus={focus}
            folded={folded}
            saveState={fieldSave}
            savedUid={typeof lastEdited === "number" ? lastEdited : -1}
            uidOf={uids.uidOf}
            markOf={(s, i) => {
              const dm = diff?.marks[i];
              const cm = cdiff?.marks[i];
              const theirs = claudeRun?.untouched
                ? cm === "new"
                  ? "added"
                  : cm === "modified"
                    ? "changed"
                    : undefined
                : undefined;
              return {
                claude: markOf(s) ?? theirs,
                diff: dm,
                before: dm === "modified" ? remote?.steps.find((b) => b.id === s.id) : undefined,
                claudeBefore: cm === "modified" ? cdiff?.was[i] : undefined,
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
            onAddPicture={async (i, p) => {
              await doc.doc.saveNow();
              doc.expect("picture");
              await execute(client, "tests.addImage", { id: testId, step: i + 1, figure: p.figure, field: p.field });
              await doc.reload("picture");
            }}
            onDraft={() =>
              app.askClaude("test", "Draft the steps of this test from its description and the documents it cites.")
            }
            onRestore={(base, gone, n, from) =>
              !refuseWhileClaude() && setDialog({ kind: "restore", base, gone, n, from })
            }
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
          {test.key && jiraKey && (
            <CommentsCard
              testKey={test.key}
              readOnly={busy}
              onOpenInJira={() => void actions.openInJira(test.key as string)}
            />
          )}
        </EditorColumn>
        {pushing && (
          <PushDialog
            testId={testId}
            testKey={test.key}
            summary={test.summary}
            review={test.review}
            onClose={actions.pushClosed}
            onDone={actions.pushDone}
            onCompare={() => {
              actions.pushClosed();
              compare();
            }}
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
        {actions.replaceDialog}
        {dialog?.kind === "undo" && remote && (
          <UndoConfirm loss={lossOf(test, remote)} onConfirm={actions.undoLocal} onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === "restore" && (
          <RestoreConfirm
            from={dialog.from}
            gone={!!dialog.gone}
            n={dialog.n}
            missing={restoreMissing}
            onClose={() => setDialog(null)}
            onConfirm={() => {
              const d = dialog;
              setDialog(null);
              if (refuseWhileClaude()) return;
              const claude = d.from === "claude";
              update((t) => (claude ? restoreRunStep(t, d.base, d.gone, d.n) : restoreStep(t, d.base, d.gone)));
              toast({
                tone: "success",
                title: d.gone
                  ? "Deleted step restored"
                  : `Step ${d.n} restored ${claude ? "as before Claude" : "from Jira"}`,
                detail: claude
                  ? "As the test was before Claude's run."
                  : "From the last sync — nothing was downloaded.",
              });
            }}
          />
        )}
        {dialog?.kind === "delete" && (
          <DeleteTest
            target={dialog.target}
            onClose={() => setDialog(null)}
            onDeleted={() => {
              setDialog(null);
              app.testsChanged();
              app.navigate("tests");
            }}
          />
        )}
        {given.dialog}
      </div>
      {analysisTab.node}
    </div>
  );
}
