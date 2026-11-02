import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalTestRef, Step, SyncState, Test } from "../../../core/types.ts";
import { call, fileUrl } from "../../api.ts";
import { RevertConflict } from "../../components/claude/RevertConflict.tsx";
import { Button, GrowArea, Icon, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { blankStep } from "../../lib/blocks.ts";
import { setFlusher } from "../../lib/editorBus.ts";
import { DEFAULT_XRAY } from "../../lib/fields.ts";
import { uploadImage } from "../../lib/files.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { addedSteps } from "../../lib/marks.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { readPref, writePref } from "../../lib/theme.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Lightbox } from "./Lightbox.tsx";
import { PushDialog } from "./PushDialog.tsx";
import { StepCard, type StepLayout } from "./StepCard.tsx";
import { TestHeader } from "./TestHeader.tsx";

export type TestShow = {
  id: string;
  test: Test;
  warnings?: string[];
  remote?: Test | null;
  sync?: SyncState;
};

type Mark = "changed" | "added";

const LAYOUTS: StepLayout[] = ["stacked", "split"];

export function TestEditor({
  testId,
  onSaved,
  onOpen,
}: {
  testId: string;
  onSaved: (ref: LocalTestRef) => void;
  onOpen: (id: string) => void;
}) {
  const app = useApp();
  const xray = app.xray ?? DEFAULT_XRAY;
  const [test, setTest] = useState<Test | null>(null);
  const [sync, setSync] = useState<SyncState>("local");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [layout, setLayout] = useState<StepLayout>(() => readPref("testimus.stepLayout", LAYOUTS, "stacked"));
  const [focus, setFocusStep] = useState(-1);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [marks, setMarks] = useState<{ runId: string; byUid: Map<number, Mark> } | null>(null);
  const [drag, setDrag] = useState(-1);
  const [dropAt, setDropAt] = useState(-1);
  const [lb, setLb] = useState<{ step: number; index: number } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const current = useRef<Test | null>(null);
  const loadedFor = useRef("");
  const pending = useRef<{ id: string; test: Test } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const uids = useRef({ map: new WeakMap<Step, number>(), n: 0 });
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const uidOf = (s: Step) => {
    const u = uids.current;
    let k = u.map.get(s);
    if (k === undefined) {
      k = ++u.n;
      u.map.set(s, k);
    }
    return k;
  };

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaving("saving");
    try {
      const ref = await call<LocalTestRef>("tests.save", { id: p.id, test: p.test });
      if (ref?.sync && loadedFor.current === p.id) setSync(ref.sync);
      if (ref) savedRef.current(ref);
      setSaving("saved");
    } catch (e) {
      setSaving("idle");
      errorToast(e, "Could not save the test");
    }
  }, []);

  const load = useCallback(async (id: string) => {
    const r = await call<TestShow>("tests.show", { id });
    const t = r.test;
    pending.current = null;
    clearTimeout(timer.current);
    current.current = t;
    loadedFor.current = id;
    setTest(t);
    setSync(r.sync ?? (t.key ? "synced" : "local"));
    setError("");
    return t;
  }, []);

  useEffect(() => {
    let dead = false;
    setTest(null);
    setMarks(null);
    setFolded(new Set());
    setFocusStep(-1);
    setSaving("idle");
    load(testId).catch((e) => {
      if (!dead) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      dead = true;
      void flush();
    };
  }, [testId, load, flush]);

  useEffect(() => {
    setFlusher(flush);
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    return () => {
      setFlusher(null);
      window.removeEventListener("blur", onBlur);
    };
  }, [flush]);

  const { setFocus } = app;
  useEffect(() => {
    if (!test) return;
    setFocus({ testId, key: test.key, summary: test.summary, step: focus >= 0 ? focus + 1 : null });
  }, [setFocus, testId, test, focus]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const lastRun = app.lastRun;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a run is consumed once, by its nonce
  useEffect(() => {
    if (!lastRun?.changedTests.includes(testId)) return;
    const before = loadedFor.current === testId ? current.current?.steps.length : undefined;
    load(testId)
      .then((t) => {
        const nums = lastRun.changedSteps[testId] ?? [];
        if (!lastRun.runId || !nums.length) {
          setMarks(null);
          return;
        }
        const byUid = new Map<number, Mark>();
        const added = addedSteps(nums, before);
        for (const k of nums) {
          const s = t.steps[k - 1];
          if (s) byUid.set(uidOf(s), added.has(k) ? "added" : "changed");
        }
        setMarks({ runId: lastRun.runId, byUid });
      })
      .catch((e) => errorToast(e, "Could not reload the test after Claude"));
  }, [lastRun?.nonce]);

  const update = (fn: (t: Test) => Test) => {
    const cur = current.current;
    if (!cur || loadedFor.current !== testId) return;
    const next = fn(cur);
    current.current = next;
    setTest(next);
    setSaving("idle");
    pending.current = { id: testId, test: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  };

  const patchStep = (i: number, fn: (s: Step) => Step) =>
    update((t) => ({
      ...t,
      steps: t.steps.map((s, k) => {
        if (k !== i) return s;
        const next = fn(s);
        uids.current.map.set(next, uidOf(s));
        return next;
      }),
    }));

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const steps = current.current?.steps ?? [];
    if (j < 0 || j >= steps.length) return;
    update((t) => {
      const a = t.steps.slice();
      [a[i], a[j]] = [a[j], a[i]];
      return { ...t, steps: a };
    });
    setFocusStep(j);
  };

  const insertStep = (at: number) => {
    update((t) => {
      const a = t.steps.slice();
      a.splice(at, 0, blankStep());
      return { ...t, steps: a };
    });
    setFocusStep(at);
  };

  const deleteStep = (i: number) => {
    const removed = current.current?.steps[i];
    if (!removed) return;
    const from = testId;
    update((t) => ({ ...t, steps: t.steps.filter((_, k) => k !== i) }));
    setFocusStep(-1);
    toast({
      kind: "info",
      title: `Step ${i + 1} deleted`,
      action: {
        label: "Undo",
        run: () => {
          if (loadedFor.current !== from) return;
          update((t) => ({ ...t, steps: [...t.steps.slice(0, i), removed, ...t.steps.slice(i)] }));
        },
      },
    });
  };

  const revertClaude = async (force = false) => {
    if (!marks) return;
    try {
      const r = await revertRun(marks.runId, force);
      setConflict(null);
      app.setLastRun({
        runId: "",
        changedTests: r.reverted?.length ? r.reverted : [testId],
        changedSteps: {},
        nonce: Date.now(),
      });
      app.testsChanged();
      toast({ kind: "info", title: "Claude's changes reverted" });
    } catch (e) {
      if (!force && editedAfterRun(e)) setConflict(message(e));
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  const showChanges = () => {
    const first = test?.steps.findIndex((s) => marks?.byUid.has(uidOf(s))) ?? -1;
    if (first < 0) return;
    document.querySelector(`[data-step="${first}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const askPush = async () => {
    if (app.claudeRunning === testId) {
      toast({ kind: "info", title: "Wait for Claude to finish", detail: "This test is being edited right now." });
      return;
    }
    await flush();
    setPushing(true);
  };

  if (error)
    return (
      <div className="editor-empty">
        <h2 className="h">This test could not be opened</h2>
        <p className="muted">{error}</p>
        <Button onClick={() => load(testId).catch((e) => setError(String(e)))}>Try again</Button>
      </div>
    );

  if (!test)
    return (
      <div className="editor" role="status" aria-busy="true" aria-label="Loading the test">
        <div className="testhead">
          <Skeleton w={220} h={10} />
          <Skeleton w="70%" h={22} />
          <Skeleton w={260} h={18} r={9} />
        </div>
        <div className="editor-scroll">
          <Skeleton w="100%" h={46} r={12} />
          <Skeleton w="100%" h={160} r={12} />
          <Skeleton w="100%" h={46} r={12} />
        </div>
      </div>
    );

  const busy = app.claudeRunning === testId;
  const url = (file: string) => fileUrl(`tests/${testId}/${file}`);
  const markOf = (s: Step) => marks?.byUid.get(uidOf(s));
  const marked = test.steps.map((s, i) => ({ m: markOf(s), i })).filter((x) => x.m);
  const lbImages = lb ? (test.steps[lb.step]?.images ?? []) : [];

  return (
    <div className="editor">
      <TestHeader
        test={test}
        sync={sync}
        saving={saving}
        layout={layout}
        folders={app.info?.project.folders ?? []}
        readOnly={busy}
        onLayout={(l) => {
          setLayout(l);
          writePref("testimus.stepLayout", l);
        }}
        onPush={() => void askPush()}
        update={update}
      />
      <div className="editor-scroll" inert={busy}>
        {busy && (
          <div className="banner" role="status">
            <span className="dot banner-dot" />
            <p>Claude is working on this test. Editing is paused until it finishes.</p>
          </div>
        )}
        {marks && marked.length > 0 && (
          <div className="banner" role="status">
            <Icon name="claude" />
            <p>
              <strong>Claude changed {plural(marked.length, "step")}</strong> —{" "}
              {marked.map((x) => `step ${x.i + 1}${x.m === "added" ? " (new)" : ""}`).join(", ")}. The test goes back
              through the check before review.
            </p>
            <Button size="sm" onClick={showChanges}>
              Show changes
            </Button>
            <Button size="sm" icon="revert" onClick={() => void revertClaude()}>
              Revert all
            </Button>
          </div>
        )}
        {marks && conflict && (
          <RevertConflict detail={conflict} onForce={() => void revertClaude(true)} onKeep={() => setConflict(null)} />
        )}
        <div className="desc">
          <label className="label" htmlFor="test-desc">
            Description
          </label>
          <GrowArea
            id="test-desc"
            className="edit desc-edit"
            placeholder="What this test verifies, and the technique used"
            value={test.description}
            onChange={(e) => update((t) => ({ ...t, description: e.target.value }))}
          />
        </div>
        {test.preconditions.map((k) => (
          <div key={k} className="precond">
            <Icon name="lock" />
            <div>
              <span className="label">
                Precondition · <span className="mono">{k}</span> · read-only, lives in Jira
              </span>
            </div>
          </div>
        ))}
        {test.steps.map((s, i) => {
          const uid = uidOf(s);
          const m = markOf(s);
          return (
            <div key={`${testId}:${uid}`} className="step-slot" data-step={i}>
              {drag >= 0 && dropAt === i && <div className="dropline" />}
              <StepCard
                index={i}
                count={test.steps.length}
                step={s}
                xray={xray}
                layout={layout}
                claude={!!m}
                added={m === "added"}
                folded={folded.has(uid)}
                dragging={drag === i}
                url={url}
                addImage={(f) => uploadImage(testId, f)}
                onChange={(fn) => patchStep(i, fn)}
                onFold={(v) =>
                  setFolded((cur) => {
                    const next = new Set(cur);
                    if (v) next.add(uid);
                    else next.delete(uid);
                    return next;
                  })
                }
                onFocus={() => setFocusStep(i)}
                onMove={(dir) => moveStep(i, dir)}
                onInsert={() => insertStep(i + 1)}
                onDelete={() => deleteStep(i)}
                onOpenImage={(file) =>
                  setLb({
                    step: i,
                    index: Math.max(
                      0,
                      s.images.findIndex((im) => im.file === file),
                    ),
                  })
                }
                onOpenSource={app.openSource}
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => {
                  if (drag < 0) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
                  if (at !== dropAt) setDropAt(at);
                }}
                onDrop={(e) => {
                  if (drag < 0) return;
                  e.preventDefault();
                  const from = drag;
                  const to = dropAt;
                  update((t) => {
                    const a = t.steps.slice();
                    const [moved] = a.splice(from, 1);
                    a.splice(from < to ? to - 1 : to, 0, moved);
                    return { ...t, steps: a };
                  });
                  setDrag(-1);
                  setDropAt(-1);
                }}
                onDragEnd={() => {
                  setDrag(-1);
                  setDropAt(-1);
                }}
              />
            </div>
          );
        })}
        {drag >= 0 && dropAt === test.steps.length && <div className="dropline" />}
        <Button icon="plus" className={cx("add-step")} onClick={() => insertStep(test.steps.length)}>
          Add step
        </Button>
      </div>
      {pushing && (
        <PushDialog
          testId={testId}
          testKey={test.key}
          summary={test.summary}
          review={test.review}
          onClose={() => setPushing(false)}
          onDone={(id) => {
            setPushing(false);
            app.testsChanged();
            if (id !== testId) onOpen(id);
            else void load(testId).catch((e) => errorToast(e, "Could not reload the test"));
          }}
        />
      )}
      {lb && lbImages.length > 0 && (
        <Lightbox
          names={lbImages.map((im) => im.file.split("/").pop() ?? im.file)}
          urls={lbImages.map((im) => url(im.file))}
          index={Math.min(lb.index, lbImages.length - 1)}
          step={lb.step + 1}
          onIndex={(index) => setLb({ ...lb, index })}
          onClose={() => setLb(null)}
        />
      )}
    </div>
  );
}
