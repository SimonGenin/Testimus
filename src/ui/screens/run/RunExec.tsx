import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { plural } from "../../lib/format.ts";
import { border, breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { RunComments } from "./RunComments.tsx";
import { RunStep } from "./RunStep.tsx";
import { RunVerdict } from "./RunVerdict.tsx";
import { nextNotRun, proposed, type RunStatus, type RunTestView, type RunView } from "./runs.ts";
import { useRunKeys } from "./useRunKeys.ts";
import { useRunTest } from "./useRunTest.ts";

const styles = stylex.create({
  body: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: { default: "row", [breakpoint.sm]: "column" },
    overflowY: { default: null, [breakpoint.sm]: "auto" },
  },
  main: {
    boxSizing: "border-box",
    flex: { default: 1, [breakpoint.sm]: "none" },
    minWidth: 0,
    minHeight: 0,
    overflowY: { default: "auto", [breakpoint.sm]: "visible" },
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s6,
    paddingInline: { default: space.s7, [breakpoint.narrow]: space.s4 },
  },
  title: { margin: 0 },
  meta: { color: color.textMuted },
  side: {
    flex: "none",
    width: { default: size.sidebar, [breakpoint.sm]: "auto" },
    display: "flex",
    minHeight: 0,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
  },
});

// ponytail: running one test of a run — its steps as frozen, OK / NOK each (written at once), the result the marks
// propose, Save and next; what the testers said beside it
export function RunExec({
  run,
  test,
  onGo,
  onBack,
}: {
  run: RunView;
  test: RunTestView;
  onGo: (testId: string) => void;
  onBack: () => void;
}) {
  const at = run.tests.findIndex((t) => t.id === test.id);
  const r = test.result;
  const act = useRunTest(run.slug, test.id);
  const [cur, setCur] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [chosen, setChosen] = useState<RunStatus | null>(null);
  const [reason, setReason] = useState(r.blockedReason ?? "");
  const status: RunStatus = chosen ?? proposed(r.steps) ?? r.status;
  const noteOf = (i: number) => notes[i] ?? r.steps[i]?.note ?? "";
  const prev = run.tests[at - 1];
  const next = run.tests[at + 1];
  const after = nextNotRun(run.tests, test.id);
  const go = after && after.id !== test.id ? after : undefined;

  const mark = (i: number, ok: boolean | null) => {
    setCur(i);
    void act.mark(i + 1, ok, ok === false ? noteOf(i) || undefined : undefined);
  };
  const noteDone = (i: number) => {
    if (notes[i] !== undefined && notes[i] !== (r.steps[i]?.note ?? "")) void act.note(i + 1, r.steps[i].ok, notes[i]);
  };
  const saveNext = async () => {
    if (status === "blocked" && !reason.trim()) return;
    const steps = Object.entries(notes)
      .filter(([i, n]) => n !== (r.steps[Number(i)]?.note ?? ""))
      .map(([i, n]) => ({ step: Number(i) + 1, ok: r.steps[Number(i)].ok, note: n }));
    const ok = await act.save({
      status,
      ...(status === "blocked" ? { blockedReason: reason } : {}),
      ...(steps.length ? { steps } : {}),
    });
    if (!ok) return;
    if (go) onGo(go.id);
    else onBack();
  };
  useRunKeys({
    mark: (ok) => mark(cur, r.steps[cur]?.ok === ok ? null : ok),
    step: (by) => setCur((c) => Math.min(Math.max(0, c + by), test.steps.length - 1)),
    saveNext: () => void saveNext(),
  });

  const meta = [
    test.key ?? "Local test",
    plural(test.steps.length, "step"),
    test.preconditions.length ? `Precondition: ${test.preconditions.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const url = (file: string) => fileUrl(`test-runs/${run.slug}/images/${test.id}/${file.replace(/^images\//, "")}`);
  return (
    <>
      <ScreenHeader title="Run" crumbs={[run.name, `Test ${at + 1} of ${run.tests.length}`]}>
        <Button variant="quiet" size="sm" label="Back to the run" icon="arrow-left" onClick={onBack} />
        <Button variant="quiet" size="sm" label="Previous" disabled={!prev} onClick={() => prev && onGo(prev.id)} />
        <Button variant="quiet" size="sm" label="Next" disabled={!next} onClick={() => next && onGo(next.id)} />
      </ScreenHeader>
      <div {...stylex.props(styles.body)}>
        <section aria-label={`Test ${test.summary}`} {...stylex.props(styles.main)}>
          <div>
            <h2 {...stylex.props(type.title, styles.title)}>{test.summary}</h2>
            <span {...stylex.props(type.small, styles.meta)}>{meta}</span>
          </div>
          {test.steps.map((s, i) => (
            <RunStep
              key={i}
              n={i + 1}
              step={s}
              mark={r.steps[i] ?? { ok: null }}
              shots={r.attachments.filter((a) => a.step === i + 1).map((a) => a.file)}
              current={i === cur}
              note={noteOf(i)}
              url={url}
              onMark={(ok) => mark(i, ok)}
              onNote={(n) => setNotes((x) => ({ ...x, [i]: n }))}
              onNoteDone={() => noteDone(i)}
              onShot={(files) => void act.shot(files, i + 1)}
            />
          ))}
          <RunVerdict
            status={status}
            reason={reason}
            busy={act.busy}
            last={!go}
            onStatus={setChosen}
            onReason={setReason}
            onSave={() => void saveNext()}
          />
        </section>
        <div {...stylex.props(styles.side)}>
          <RunComments comments={r.comments} steps={test.steps.length} onSend={act.comment} />
        </div>
      </div>
    </>
  );
}
