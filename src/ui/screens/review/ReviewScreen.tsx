import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { docLink } from "../../components/sources/PassageView.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { useApp } from "../../lib/app.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { usePref } from "../../lib/prefs.ts";
import { editedAfterRun } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, container, fontSize, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { PushDialog } from "../tests/PushDialog.tsx";
import { FixNote } from "./FixNote.tsx";
import { ReviewEdit } from "./ReviewEdit.tsx";
import { ReviewEmpty, ReviewLoading } from "./ReviewEmpty.tsx";
import { ReviewFoot } from "./ReviewFoot.tsx";
import { ReviewQueue } from "./ReviewQueue.tsx";
import { ReviewTest } from "./ReviewTest.tsx";
import { SourcePanel } from "./SourcePanel.tsx";
import { notAtAnchor, placedSources, refKey } from "./sources.ts";
import { useDecisions, useQueueFilters, useReviewData } from "./useReview.ts";
import { useReviewKeys } from "./useReviewKeys.ts";
import { useReviewView } from "./useReviewView.ts";

const QUEUE = { min: 240, max: 480, initial: 300 };
const SOURCE = { min: 300, max: 720, initial: 420 };

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
  review: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    containerName: "review",
    containerType: "inline-size",
  },
  queueEdge: { display: { default: "flex", [container.reviewQueue]: "none" } },
  sourceEdge: { display: { default: "flex", [container.reviewSource]: "none" } },
  strip: {
    display: { default: "none", [container.reviewQueue]: "flex" },
    flex: "none",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    width: size.controlLg,
    paddingBlock: space.s3,
    borderRightWidth: border.width,
    borderRightStyle: "solid",
    borderRightColor: color.border,
    backgroundColor: color.surface,
  },
  pos: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
    color: color.textMuted,
    writingMode: "vertical-rl",
  },
  main: {
    flex: "1 1 0",
    minWidth: size.dock,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    backgroundColor: color.canvas,
  },
  notice: { padding: space.s5 },
});

export function ReviewScreen() {
  const app = useApp();
  const routeId = app.route.screen === "review" ? (app.route.arg ?? "") : "";
  const filters = useQueueFilters();
  const d = useReviewData(routeId, filters);
  const { items, data, activeId } = d;
  const open = (id: string | null) => (id ? app.navigate("review", id) : app.navigate("review"));
  const act = useDecisions(d.input, open);
  const view = useReviewView(activeId, data, app.lastRun);
  const revert = useCommand("claude.revert", { flushFirst: [["tests.show"]] });
  const [queueW, setQueueW] = usePref("queueWidth");
  const [sourceW, setSourceW] = usePref("sourceWidth");
  const [drag, setDrag] = useState<{ queue?: number; source?: number }>({});
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [revertConflict, setRevertConflict] = useState<string | null>(null);
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

  const placed = data ? placedSources(data.test, data.check) : [];
  const sel = view.sel;
  const selKey = sel ? refKey(sel.source) : "";
  const selIndex = sel ? placed.findIndex((s) => refKey(s.source) === selKey && s.step === sel.step) : -1;
  const findings = data?.check?.findings ?? [];
  const running = !!data && app.claudeRunning === data.id;
  const label = data ? (data.test.key ?? data.test.summary) : "";
  const at = items?.findIndex((t) => t.id === activeId) ?? -1;

  const move = (by: 1 | -1) => {
    if (!items?.length) return;
    const next = items[Math.min(items.length - 1, Math.max(0, at + by))];
    if (next && next.id !== activeId) open(next.id);
  };

  const selectStep = (i: number) => {
    if (!data) return;
    const n = Math.max(0, Math.min(data.test.steps.length - 1, i));
    const own = placed.find((s) => s.step === n + 1);
    view.patch({ activeStep: n, ...(own && view.sel ? { sel: own } : {}) });
    requestAnimationFrame(() =>
      body.current
        ?.querySelector(`[aria-label="Step ${n + 1}"]`)
        ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
    );
  };

  const decide = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    if (!data || view.fixOpen || running) return;
    void decide(() => act.validate(data.id, label, items ?? []));
  };

  const markToFix = (note: string, askClaude: boolean) => {
    if (!data) return;
    view.patch({ fixOpen: false });
    if (askClaude) askFix(note);
    else void decide(() => act.markToFix(data.id, label, items ?? [], note));
  };

  const askFix = (note?: string) => {
    if (!data) return;
    const text = note ?? data.test.reviewNote ?? "";
    void act.flush(data.id).then(() =>
      app.runInDock({
        name: "review.fix",
        input: note ? { id: data.id, note } : { id: data.id },
        label: text || "Fix the test",
        testId: data.id,
      }),
    );
  };

  const undo = async (force = false) => {
    if (!view.marks) return;
    try {
      await revert.mutateAsync(force ? { runId: view.marks.runId, force: true } : { runId: view.marks.runId });
      setRevertConflict(null);
      view.patch({ marks: null });
      app.setLastRun({ runId: "", changedTests: [], changedSteps: {}, nonce: Date.now() });
      toast({ kind: "info", title: "Claude's changes reverted" });
    } catch (e) {
      if (!force && (editedAfterRun(e) || (e as { code?: string }).code === "edited-after-run"))
        setRevertConflict(e instanceof Error ? e.message : String(e));
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  useReviewKeys({
    next: () => move(1),
    previous: () => move(-1),
    validate,
    toFix: () => data && !running && view.patch({ fixOpen: true }),
    step: (by) => data && selectStep(view.activeStep + by),
    editing: view.editing,
    off: view.fixOpen || pushing,
  });

  const queueWidth = drag.queue ?? queueW ?? QUEUE.initial;
  const sourceWidth = drag.source ?? sourceW ?? SOURCE.initial;
  const pick = (ref: string) => {
    const own = placed.find((s) => refKey(s.source) === ref);
    const i = ref.indexOf("#");
    view.patch({
      sel: own ?? {
        source: { docId: ref.slice(0, i), anchor: ref.slice(i + 1), quote: "" },
        step: null,
        label: "Read by the generation",
      },
    });
  };

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Review" />
      <div {...stylex.props(styles.review)}>
        <ReviewQueue
          items={items}
          counts={d.counts}
          activeId={activeId}
          filter={filters.filter}
          sort={filters.sort}
          folder={filters.folder}
          folders={d.folders}
          withFindings={filters.withFindings}
          onFilter={filters.setFilter}
          onSort={filters.setSort}
          onFolder={filters.setFolder}
          onWithFindings={filters.setWithFindings}
          onOpen={open}
          width={queueW === null && drag.queue === undefined ? undefined : queueWidth}
          checkAll={{ ids: d.needsCheck, running: act.checking, onCheck: () => act.check(d.needsCheck) }}
          error={d.queueError ? { message: d.queueError, onRetry: d.retryQueue } : undefined}
          notice={
            d.unchecked.length > 0 && (
              <Banner
                compact
                title={`${plural(d.unchecked.length, "test")} not checked yet`}
                actions={
                  <Button
                    size="sm"
                    icon="eye"
                    label="Check"
                    loading={act.checking}
                    onClick={() => act.check(d.unchecked)}
                  />
                }
              >
                The check finds what the documents do not support.
              </Banner>
            )
          }
        />
        <div {...stylex.props(styles.queueEdge)}>
          <ResizeHandle
            label="Resize the review queue"
            value={queueWidth}
            min={QUEUE.min}
            max={QUEUE.max}
            defaultValue={QUEUE.initial}
            onChange={(px) => setDrag((cur) => ({ ...cur, queue: px }))}
            onCommit={(px) => {
              setQueueW(px === QUEUE.initial ? null : px);
              setDrag((cur) => ({ ...cur, queue: undefined }));
            }}
          />
        </div>
        <nav aria-label="Review queue, folded" {...stylex.props(styles.strip)}>
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-up"
            label="Previous test (K)"
            disabled={!items?.length}
            onClick={() => move(-1)}
          />
          <span {...stylex.props(styles.pos)} data-testid="queue-position">
            {items?.length ? `${Math.max(0, at) + 1} / ${items.length}` : "0"}
          </span>
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-down"
            label="Next test (J)"
            disabled={!items?.length}
            onClick={() => move(1)}
          />
        </nav>
        <section aria-label="Test under review" {...stylex.props(styles.main)}>
          {view.editing && data ? (
            <ReviewEdit
              id={data.id}
              testKey={data.test.key}
              onAsk={() => app.askClaude("test")}
              onBack={() => void act.flush(data.id).then(() => view.patch({ editing: false }))}
              onOpen={(id) => app.navigate("tests", id)}
            />
          ) : d.loadError ? (
            <div {...stylex.props(styles.notice)}>
              <Banner tone="danger" title="This test could not be opened">
                {d.loadError}
              </Banner>
            </div>
          ) : !activeId ? (
            items && (
              <ReviewEmpty
                validated={filters.filter === "all" ? (d.counts?.validated ?? 0) : 0}
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
              sync={data.sync}
              edited={data.edited}
              check={data.check}
              stale={data.stale}
              xray={app.xray}
              folded={view.folded}
              activeStep={view.activeStep}
              selected={selKey}
              selectedStep={sel ? sel.step : undefined}
              marks={view.marks}
              claudeRunning={running}
              claudeReady={d.claudeReady}
              url={(file) => fileUrl(`tests/${data.id}/${file}`)}
              onFold={view.fold}
              onFoldAll={(f) => view.foldAll(f, data.test.steps.length)}
              onSelect={(source, step) => {
                const same = sel && refKey(source) === selKey && sel.step === step;
                view.patch({ sel: same ? null : { source, step }, ...(step ? { activeStep: step - 1 } : {}) });
              }}
              onOpenImage={(file) => window.open(fileUrl(`tests/${data.id}/${file}`), "_blank")}
              onEdit={() => view.patch({ editing: true })}
              onRevert={() => void undo()}
              revertConflict={revertConflict}
              fixMessage={
                app.lastRun?.testId === data.id &&
                app.lastRun.review &&
                app.lastRun.review !== "checked" &&
                app.lastRun.review === data.test.review
                  ? app.lastRun.message || "Claude's fix did not bring the test back to Checked."
                  : undefined
              }
              onRevertAnyway={() => void undo(true)}
              onKeepAfterRun={() => setRevertConflict(null)}
              onCompare={() => app.navigate("tests", data.id)}
              onTakeJira={() => data.test.key && act.takeJira(data.test.key)}
              onKeepMine={() => setPushing(true)}
              pulling={act.pulling}
              checking={act.checking}
              onCheck={() => act.check([data.id])}
              onAskFix={() => askFix()}
              onEditNote={() => view.patch({ fixOpen: true })}
            />
          )}
          {!view.editing && (
            <ReviewFoot
              errors={findings.filter((f) => f.severity === "error").length}
              stale={!!data?.stale}
              off={!data || busy || (running && "Claude is working on this test — wait for it to finish")}
              fixOpen={view.fixOpen}
              onToFix={() => view.patch({ fixOpen: !view.fixOpen })}
              onValidate={validate}
            />
          )}
        </section>
        {!view.editing && sel && (
          <>
            <div {...stylex.props(styles.sourceEdge)}>
              <ResizeHandle
                label="Resize the source panel"
                side="left"
                value={sourceWidth}
                min={SOURCE.min}
                max={SOURCE.max}
                defaultValue={SOURCE.initial}
                onChange={(px) => setDrag((cur) => ({ ...cur, source: px }))}
                onCommit={(px) => {
                  setSourceW(px === SOURCE.initial ? null : px);
                  setDrag((cur) => ({ ...cur, source: undefined }));
                }}
              />
            </div>
            <SourcePanel
              source={sel.source}
              label={sel.label ?? (sel.step ? `Source of step ${sel.step}` : "Source of the whole-test finding")}
              index={Math.max(0, selIndex)}
              total={placed.length}
              testId={data?.id ?? ""}
              misplaced={notAtAnchor(findings, selKey, sel.step)}
              width={sourceW === null && drag.source === undefined ? undefined : sourceWidth}
              onClose={() => view.patch({ sel: null })}
              onOpenDoc={(docId, anchor, quote) => app.navigate("documents", docLink(docId, anchor, quote))}
              onPick={pick}
              onStep={(by) => {
                const next = placed[Math.max(0, selIndex) + by];
                if (next) view.patch({ sel: next, ...(next.step ? { activeStep: next.step - 1 } : {}) });
              }}
            />
          </>
        )}
      </div>
      {view.fixOpen && data && (
        <FixNote
          id={data.id}
          initial={data.test.review === "to-fix" ? (data.test.reviewNote ?? "") : ""}
          subtitle={[data.test.summary, data.test.key].filter(Boolean).join(" · ")}
          claudeReady={d.claudeReady}
          onCancel={() => view.patch({ fixOpen: false })}
          onSubmit={markToFix}
        />
      )}
      {pushing && data && (
        <PushDialog
          testId={data.id}
          testKey={data.test.key}
          summary={data.test.summary}
          review={data.test.review}
          onDone={() => setPushing(false)}
          onClose={() => setPushing(false)}
          onCompare={() => app.navigate("tests", data.id)}
        />
      )}
    </div>
  );
}
