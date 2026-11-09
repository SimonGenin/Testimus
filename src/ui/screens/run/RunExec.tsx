import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { runImage } from "../../../shared/run-image.ts";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { useApp } from "../../lib/app.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { usePref } from "../../lib/prefs.ts";
import { column, layoutOf, section } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { color, container, size, space } from "../../styles/tokens.stylex.ts";
import { Lightbox } from "../tests/Lightbox.tsx";
import type { StepLayout } from "../tests/StepCard.tsx";
import { RunComments } from "./RunComments.tsx";
import { RunExecBar } from "./RunExecBar.tsx";
import { RunHead } from "./RunHead.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { PanelSection, RunPanel, ShotsSection } from "./RunPanel.tsx";
import { RunStep } from "./RunStep.tsx";
import { RunStepsHead } from "./RunStepsHead.tsx";
import { RunTestList } from "./RunTestList.tsx";
import { RunVerdict } from "./RunVerdict.tsx";
import { nextNotRun, type RunStatus, type RunTestView, type RunView, type TestView } from "./runs.ts";
import { useRunKeys } from "./useRunKeys.ts";
import { useRunPaste } from "./useRunPaste.ts";
import { useRunTest } from "./useRunTest.ts";

const styles = stylex.create({
  center: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.canvas,
    containerType: "inline-size",
  },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  col: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `calc(${size.reading} + ${size.dock})`,
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingTop: space.s6,
    paddingBottom: space.s10,
    paddingInline: { default: space.s7, [container.paneCompact]: space.s4 },
  },
});

// ponytail: a test being run — the run's tests on the left, the frozen test in the middle, the testing panel and
// Claude on the right
const LAYOUT = layoutOf(
  column(300, section(["tests"])),
  column(null, section(["step"])),
  column(380, section(["testing", "claude"])),
);

type Box = { names: string[]; urls: string[]; index: number; step: number } | null;

// ponytail: running one test of a run, in sections — the run's tests, the frozen test with OK / NOK on each step
// (written at once), and the testing panel: screenshots, comments and questions, the same test in other runs, the
// result (set by the marks as they change, or picked: saved at once; Blocked once its reason is said) and Next test.
// A screenshot dropped on a step or pasted goes to that step; Claude reads the run from its tab
export function RunExec({
  run,
  test,
  view,
  onView,
  onGo,
  onBack,
  me,
}: {
  me: string;
  run: RunView;
  test: RunTestView;
  view: TestView;
  onView: (v: TestView) => void;
  onGo: (testId: string) => void;
  onBack: () => void;
}) {
  const app = useApp();
  const at = run.tests.findIndex((t) => t.id === test.id);
  const r = test.result;
  const act = useRunTest(run.slug, test.id);
  const [shape, setLayout] = usePref("stepLayout");
  const layout = shape as StepLayout;
  const [fold, setFold] = usePref("runFoldOk");
  const [cur, setCur] = useState(() =>
    Math.max(
      0,
      r.steps.findIndex((s) => s.ok === null),
    ),
  );
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [chosen, setChosen] = useState<RunStatus | null>(null);
  const [reason, setReason] = useState(r.blockedReason ?? "");
  const [box, setBox] = useState<Box>(null);
  const status: RunStatus = chosen ?? r.status;
  const noteOf = (i: number) => notes[i] ?? r.steps[i]?.note ?? "";
  const prev = run.tests[at - 1];
  const next = run.tests[at + 1];
  const after = nextNotRun(run.tests, test.id);
  const go = after && after.id !== test.id ? after : undefined;
  const dir = `test-runs/${run.slug}`;
  const url = (file: string) => fileUrl(`${dir}/${runImage(test.id, file)}`);
  const shotUrl = (file: string) => fileUrl(`${dir}/results/${test.id}/${file}`);

  const { setFocus, askClaude } = app;
  useEffect(() => {
    setFocus({ testId: test.id, key: test.key, summary: test.summary, step: cur + 1, run: run.slug });
  }, [setFocus, test.id, test.key, test.summary, cur, run.slug]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const mark = (i: number, ok: boolean | null) => {
    setCur(i);
    void act.mark(i + 1, ok, ok === false ? noteOf(i) || undefined : undefined);
  };
  const noteDone = (i: number) => {
    if (notes[i] !== undefined && notes[i] !== (r.steps[i]?.note ?? "")) void act.note(i + 1, r.steps[i].ok, notes[i]);
  };
  const shoot = (i: number, files: File[]) => {
    setCur(i);
    void act.shot(files, i + 1);
  };
  const pick = (s: RunStatus) => {
    if (s === "blocked" && !reason.trim()) {
      setChosen("blocked");
      return;
    }
    setChosen(null);
    if (s !== r.status || (s === "blocked" && reason.trim() !== (r.blockedReason ?? "")))
      void act.save({ status: s, ...(s === "blocked" ? { blockedReason: reason } : {}) });
  };
  const reasonDone = () => {
    if (status === "blocked" && reason.trim() && reason.trim() !== (r.blockedReason ?? "")) pick("blocked");
  };
  const saveNext = async () => {
    if (status === "blocked" && !reason.trim()) return;
    const steps = Object.entries(notes)
      .filter(([i, n]) => n !== (r.steps[Number(i)]?.note ?? ""))
      .map(([i, n]) => ({ step: Number(i) + 1, ok: r.steps[Number(i)].ok, note: n }));
    const blocked = status === "blocked" && (chosen || reason.trim() !== (r.blockedReason ?? ""));
    if (steps.length || blocked) {
      const ok = await act.save({
        ...(blocked ? { status, blockedReason: reason } : {}),
        ...(steps.length ? { steps } : {}),
      });
      if (!ok) return;
    }
    if (go) onGo(go.id);
    else onBack();
  };
  const restOk = () => {
    const left = r.steps.flatMap((s, i) => (s.ok === null ? [{ step: i + 1, ok: true }] : []));
    if (left.length) void act.marks(left);
  };
  const openShot = (file: string) => {
    const names = r.attachments.map((a) => a.file);
    const a = r.attachments.find((x) => x.file === file);
    setBox({ names, urls: names.map(shotUrl), index: Math.max(0, names.indexOf(file)), step: a?.step ?? cur + 1 });
  };
  const openImage = (i: number, file: string) => {
    const names = test.steps[i].images;
    setBox({ names, urls: names.map(url), index: Math.max(0, names.indexOf(file)), step: i + 1 });
  };

  useRunKeys({
    mark: (ok) => mark(cur, r.steps[cur]?.ok === ok ? null : ok),
    step: (by) => setCur((c) => Math.min(Math.max(0, c + by), test.steps.length - 1)),
    saveNext: () => void saveNext(),
  });
  useRunPaste((files) => {
    shoot(cur, files);
    if (r.steps[cur]?.ok === null) mark(cur, false);
  });

  const claude = useClaudeTab();
  const ws = useWorkspace({
    pref: "layoutRunTest",
    label: "Run",
    defaults: LAYOUT,
    tabs: [
      {
        id: "tests",
        label: "Tests of the run",
        icon: "tree",
        count: run.tests.length,
        content: (
          <RunTestList
            run={run}
            open={test.id}
            view={view}
            onView={onView}
            me={me}
            onOpen={(id) => id !== test.id && onGo(id)}
          />
        ),
      },
      {
        id: "step",
        label: "Step",
        icon: "play",
        main: true,
        content: (
          <section aria-label={`Test ${test.summary}`} {...stylex.props(styles.center)}>
            <RunExecBar
              test={test}
              at={at + 1}
              total={run.tests.length}
              frozenAt={run.createdAt}
              onPrev={prev ? () => onGo(prev.id) : undefined}
              onNext={next ? () => onGo(next.id) : undefined}
              onAsk={() => askClaude("test")}
              onOpenTest={() => app.navigate("tests", test.id)}
            />
            <div {...stylex.props(styles.scroll)}>
              <div {...stylex.props(styles.col)}>
                <RunHead test={test} proposed={r.proposed} />
                <RunStepsHead
                  result={r}
                  layout={layout}
                  fold={fold}
                  onLayout={setLayout}
                  onFold={setFold}
                  onRestOk={restOk}
                />
                {test.steps.map((s, i) => (
                  <RunStep
                    key={i}
                    n={i + 1}
                    step={s}
                    mark={r.steps[i] ?? { ok: null }}
                    shots={r.attachments.filter((a) => a.step === i + 1).map((a) => a.file)}
                    questions={r.comments.filter((c) => c.kind === "question" && !c.answer && c.step === i + 1).length}
                    current={i === cur}
                    layout={layout}
                    folded={fold}
                    note={noteOf(i)}
                    url={url}
                    shotUrl={shotUrl}
                    onCurrent={() => setCur(i)}
                    onMark={(ok) => mark(i, ok)}
                    onNote={(n) => setNotes((x) => ({ ...x, [i]: n }))}
                    onNoteDone={() => noteDone(i)}
                    onShot={(files) => shoot(i, files)}
                    onOpenShot={openShot}
                    onRemoveShot={(file) => void act.unshot(file)}
                    onImage={(file) => openImage(i, file)}
                    onAsk={() => {
                      setCur(i);
                      askClaude("step");
                    }}
                    onOpenSource={(src) =>
                      app.openSource(src, { test: test.id, step: i + 1, sources: s.sources ?? [] })
                    }
                  />
                ))}
              </div>
            </div>
          </section>
        ),
      },
      {
        id: "testing",
        label: "Testing",
        icon: "check-circle",
        content: (
          <RunPanel
            foot={
              <RunVerdict
                status={status}
                proposed={r.proposed}
                recorded={!chosen}
                reason={reason}
                busy={act.busy}
                last={!go}
                onStatus={pick}
                onReason={setReason}
                onReasonDone={reasonDone}
                onSave={() => void saveNext()}
              />
            }
          >
            <ShotsSection
              result={r}
              step={cur + 1}
              shotUrl={shotUrl}
              onShot={(files) => shoot(cur, files)}
              onOpen={openShot}
              onRemove={(file) => void act.unshot(file)}
            />
            <PanelSection title="Comments and questions" count={r.comments.length}>
              <RunComments
                comments={r.comments}
                steps={test.steps.length}
                step={cur + 1}
                onSend={act.comment}
                onAsk={(q) =>
                  askClaude("test", `Answer this question of a tester${q.step ? ` on step ${q.step}` : ""}: ${q.text}`)
                }
              />
            </PanelSection>
            <PanelSection title="This test in other runs">
              <RunHistory test={test.id} run={run.slug} />
            </PanelSection>
          </RunPanel>
        ),
      },
      claude,
    ],
  });

  return (
    <>
      <ScreenHeader
        title="Run"
        back={{ to: "the run", onClick: onBack }}
        crumbs={[{ label: run.name, onClick: onBack }, `Test ${at + 1} of ${run.tests.length}`]}
      />
      <Workspace ws={ws} />
      {box && (
        <Lightbox
          names={box.names}
          urls={box.urls}
          index={box.index}
          step={box.step}
          onIndex={(index) => setBox((b) => (b ? { ...b, index } : b))}
          onClose={() => setBox(null)}
        />
      )}
    </>
  );
}
