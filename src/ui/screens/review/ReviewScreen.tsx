import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { claudeOn } from "../../components/claude/turns.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { docLink } from "../../components/sources/PassageView.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { type ClaudeRun, useApp } from "../../lib/app.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { column, layoutOf, section } from "../../lib/workspace/layout.ts";
import { useWorkspace, type WorkspaceController } from "../../lib/workspace/useWorkspace.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Lightbox } from "../tests/Lightbox.tsx";
import { PushDialog } from "../tests/PushDialog.tsx";
import { FixNote } from "./FixNote.tsx";
import { filtered } from "./queueFilters.ts";
import { ReviewEdit } from "./ReviewEdit.tsx";
import { ReviewEmpty, ReviewLoading } from "./ReviewEmpty.tsx";
import { ReviewFoot } from "./ReviewFoot.tsx";
import { QueueFoot, ReviewQueue } from "./ReviewQueue.tsx";
import { ReviewTest } from "./ReviewTest.tsx";
import { SourceFoot, SourcePanel } from "./SourcePanel.tsx";
import { chipOpened, findingOpened, moveOpened, notAtAnchor, openedIndex, refKey, stepOpened } from "./sources.ts";
import { type Loaded, takeEditAsk, useDecisions, useQueueFilters, useReviewData } from "./useReview.ts";
import { useReviewActions } from "./useReviewActions.ts";
import { useReviewKeys } from "./useReviewKeys.ts";
import { useReviewView } from "./useReviewView.ts";

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    backgroundColor: color.canvas,
  },
  notice: { padding: space.s5 },
  none: { flex: 1, display: "flex", padding: space.s6 },
});

// ponytail: the queue on the left, the test reviewed in the middle, its source and Claude on the right
const LAYOUT = layoutOf(
  column(300, section(["queue"])),
  column(null, section(["test"])),
  column(420, section(["source", "claude"])),
);

// ponytail: the message of Claude's last fix of this test, while the test is still in the state the fix left it in
const fixMessage = (run: ClaudeRun | null, data: Loaded) =>
  run?.testId === data.id && run.message && run.review === data.test.review ? run.message : undefined;

export function ReviewScreen() {
  const app = useApp();
  const routeId = app.route.screen === "review" ? (app.route.arg ?? "") : "";
  const filters = useQueueFilters();
  const d = useReviewData(routeId, filters);
  const { items, data, activeId } = d;
  const open = (id: string | null) => (id ? app.navigate("review", id) : app.navigate("review"));
  const act = useDecisions(d.input, filters.value, open, app.navigate);
  const view = useReviewView(activeId, data, app.lastRun);
  const claudeQ = useRead("claude.before", { testId: activeId }, { enabled: !!activeId });
  // biome-ignore lint/correctness/useExhaustiveDependencies: taken once, when that test shows
  useEffect(() => {
    if (activeId && takeEditAsk(activeId)) view.patch({ editing: true });
  }, [activeId]);
  const running = claudeOn(app.claudeRunning, data?.id);
  const acts = useReviewActions({ app, data, items, act, view, running });
  const [pushing, setPushing] = useState(false);
  const sections = useRef<WorkspaceController | null>(null);
  const showSource = () => sections.current?.reveal("source");
  const [lb, setLb] = useState<{ step: number; index: number; column?: string } | null>(null);
  const lbImages = (lb && data?.test.steps[lb.step - 1]?.images) || [];
  const body = useRef<HTMLDivElement>(null);

  const { setFocus } = app;
  useEffect(() => {
    if (!data) return;
    setFocus({
      testId: data.id,
      key: data.test.key,
      summary: data.test.summary,
      step: view.activeStep >= 0 ? view.activeStep + 1 : null,
    });
  }, [setFocus, data, view.activeStep]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const sel = view.sel;
  const selKey = sel ? refKey(sel.source) : "";
  const findings = data?.check?.findings ?? [];
  const at = items?.findIndex((t) => t.id === activeId) ?? -1;

  const move = (by: 1 | -1) => {
    if (!items?.length) return;
    const next = items[Math.min(items.length - 1, Math.max(0, at + by))];
    if (next && next.id !== activeId) open(next.id);
  };

  const selectStep = (i: number) => {
    if (!data) return;
    const n = Math.max(0, Math.min(data.test.steps.length - 1, i));
    const own = view.sel ? stepOpened(data.test, data.check, n + 1) : null;
    view.patch({ activeStep: n, ...(own ? { sel: own } : {}) });
    requestAnimationFrame(() =>
      body.current
        ?.querySelector(`[aria-label="Step ${n + 1}"]`)
        ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
    );
  };

  useReviewKeys({
    next: () => move(1),
    previous: () => move(-1),
    validate: acts.validate,
    toFix: () => data && !running && !acts.busy && view.patch({ fixOpen: true }),
    step: (by) => data && selectStep(view.activeStep + by),
    editing: view.editing,
    off: view.fixOpen || pushing,
  });

  const editing =
    view.editing && data
      ? {
          name: data.test.key ?? data.id,
          done: () => void act.flush(data.id).then(() => view.patch({ editing: false })),
        }
      : null;

  const queueTab = (
    <ReviewQueue
      items={items}
      groups={d.groups}
      counts={d.counts}
      activeId={activeId}
      queued={d.queued}
      filters={filters.value}
      sort={filters.sort}
      onWords={filters.setWords}
      onStates={filters.setStates}
      onChecks={filters.setChecks}
      onFolders={filters.setFolders}
      onSort={filters.setSort}
      onClearFilters={filters.clear}
      onOpen={open}
      error={d.queueError ? { message: d.queueError, onRetry: d.retryQueue } : undefined}
      notice={
        d.needsCheck.length > 0 && (
          <Banner
            compact
            actions={
              <Button
                size="sm"
                icon="review"
                label="Check all"
                loading={act.checking}
                onClick={() => act.check(d.needsCheck)}
              />
            }
          >
            {d.unchecked.length === d.needsCheck.length
              ? `${plural(d.unchecked.length, "test")} not checked yet.`
              : `${plural(d.needsCheck.length, "test")} not checked yet, or changed since their check.`}
          </Banner>
        )
      }
    />
  );

  const testTab = (
    <section aria-label="Test under review" {...stylex.props(styles.main)}>
      {editing && data ? (
        <ReviewEdit id={data.id} onBack={editing.done} onOpen={(id) => app.navigate("tests", id)} />
      ) : d.loadError ? (
        <div {...stylex.props(styles.notice)}>
          <Banner tone="danger" title="This test could not be opened">
            {d.loadError}
          </Banner>
        </div>
      ) : !activeId ? (
        items && (
          <ReviewEmpty
            validated={d.counts?.validated ?? 0}
            narrowed={filtered(filters.value) ? { onClear: filters.clear } : undefined}
            onGenerate={() => app.navigate("generate")}
            onTests={() => app.navigate("tests")}
          />
        )
      ) : !data ? (
        <ReviewLoading />
      ) : (
        <ReviewTest
          bodyRef={body}
          test={data.test}
          testId={data.id}
          sync={data.sync}
          edited={data.edited}
          check={data.check}
          stale={data.stale}
          xray={app.xray}
          folded={view.folded}
          activeStep={view.activeStep}
          selected={sel?.mark ?? ""}
          selectedStep={sel ? sel.step : undefined}
          marks={view.marks}
          claudeRun={data.id === activeId ? (claudeQ.data ?? null) : null}
          claudeRunning={running}
          claudeReady={d.claudeReady}
          url={(file) => fileUrl(`tests/${data.id}/${file}`)}
          onFold={view.fold}
          onFoldAll={(f) => view.foldAll(f, data.test.steps.length)}
          onSelect={(source, step, finding) => {
            const next =
              finding !== undefined
                ? findingOpened(data.test, data.check, finding, source)
                : step
                  ? chipOpened(data.test, step, source)
                  : null;
            const same = !!next && sel?.mark === next.mark;
            view.patch({ sel: same ? null : next, ...(step ? { activeStep: step - 1 } : {}) });
            if (next && !same) showSource();
          }}
          onOpenImage={(file, step, column) => {
            const images = data.test.steps[step - 1]?.images ?? [];
            setLb({
              step,
              column,
              index: Math.max(
                0,
                images.findIndex((im) => im.file === file),
              ),
            });
          }}
          onEdit={() => view.patch({ editing: true })}
          onRevert={() => acts.undo()}
          revertConflict={acts.revertConflict}
          fixMessage={fixMessage(app.lastRun, data)}
          onRevertAnyway={() => acts.undo(true)}
          onKeepAfterRun={acts.keepAfterRun}
          onCompare={() => view.patch({ editing: true })}
          onTakeJira={() => data.test.key && act.takeJira(data.id, data.test.key)}
          onKeepMine={() => setPushing(true)}
          pulling={act.pulling(data.id)}
          checking={act.checking}
          onCheck={() => act.check([data.id])}
          onAskFix={acts.askFix}
          onEditNote={() => view.patch({ fixOpen: true })}
          onToDraft={acts.toDraft}
        />
      )}
    </section>
  );

  const decisions =
    !view.editing && activeId ? (
      <ReviewFoot
        errors={findings.filter((f) => f.severity === "error").length}
        stale={!!data?.stale}
        off={!data || acts.busy || (running && "Claude is working on this test — wait for it to finish")}
        fixOpen={view.fixOpen}
        marked={data?.test.review === "to-fix"}
        onToFix={() => view.patch({ fixOpen: !view.fixOpen })}
        onValidate={acts.validate}
      />
    ) : undefined;

  const openDoc = (docId: string, anchor: string, quote: string) =>
    app.navigate(
      "documents",
      docLink(
        docId,
        anchor,
        quote,
        data && sel ? { test: data.id, ...(sel.step && { step: sel.step }), screen: "review" } : undefined,
      ),
    );
  const stepSource = (by: 1 | -1) => {
    const next = data && sel && moveOpened(data.test, data.check, sel, by);
    if (next) view.patch({ sel: next });
  };
  const sourceTab = sel ? (
    <SourcePanel
      source={sel.source}
      label={sel.label ?? (sel.step ? `Source of step ${sel.step}` : "Source of the whole-test finding")}
      misplaced={notAtAnchor(findings, selKey, sel.step)}
      onClose={() => view.patch({ sel: null })}
    />
  ) : (
    <div {...stylex.props(styles.none)}>
      <EmptyState
        icon="quote"
        title="No source open"
        text="Click a source of a step, or a finding, to read the passage it names here."
        compact
      />
    </div>
  );

  const claude = useClaudeTab();
  const ws = useWorkspace({
    pref: "layoutReview",
    label: "Review",
    defaults: LAYOUT,
    tabs: [
      {
        id: "queue",
        label: "Queue",
        icon: "list",
        count: d.counts ? d.counts.toFix + d.counts.draft : undefined,
        content: queueTab,
        footer: <QueueFoot at={at} total={items?.length ?? 0} onMove={move} />,
      },
      { id: "test", label: "Test", icon: "tests", main: true, content: testTab, footer: decisions },
      {
        id: "source",
        label: "Source",
        icon: "quote",
        content: sourceTab,
        footer: sel ? (
          <SourceFoot
            source={sel.source}
            index={openedIndex(sel)}
            total={sel.list.length}
            onOpenDoc={openDoc}
            onStep={stepSource}
          />
        ) : undefined,
      },
      claude,
    ],
  });
  sections.current = ws;

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader
        title="Review"
        back={editing ? { to: "review", onClick: editing.done } : undefined}
        crumbs={editing ? [{ label: editing.name, onClick: editing.done }, "Editing"] : []}
      />
      <Workspace ws={ws} />
      {view.fixOpen && data && (
        <FixNote
          id={data.id}
          initial={data.test.review === "to-fix" ? (data.test.reviewNote ?? "") : ""}
          summary={data.test.summary}
          testKey={data.test.key}
          claudeReady={d.claudeReady}
          onDoctor={() => app.navigate("doctor")}
          onCancel={() => view.patch({ fixOpen: false })}
          onSubmit={acts.markToFix}
        />
      )}
      {lb && data && lbImages.length > 0 && (
        <Lightbox
          names={lbImages.map((im) => im.file.split("/").pop() ?? im.file)}
          urls={lbImages.map((im) => fileUrl(`tests/${data.id}/${im.file}`))}
          index={Math.min(lb.index, lbImages.length - 1)}
          step={lb.step}
          column={lb.column}
          onIndex={(index) => setLb({ ...lb, index })}
          onClose={() => setLb(null)}
        />
      )}
      {act.replaceDialog}
      {pushing && data && (
        <PushDialog
          testId={data.id}
          testKey={data.test.key}
          summary={data.test.summary}
          review={data.test.review}
          onDone={() => setPushing(false)}
          onClose={() => setPushing(false)}
          onCompare={() => {
            setPushing(false);
            view.patch({ editing: true });
          }}
        />
      )}
    </div>
  );
}
