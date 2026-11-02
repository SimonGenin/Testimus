import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckFile, Source, SyncState, Test } from "../../../core/types.ts";
import { call, fileUrl, run } from "../../api.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Button, Icon, IconButton, Kbd, Severity, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { flushEditor } from "../../lib/editorBus.ts";
import { message, plural } from "../../lib/format.ts";
import { addedSteps } from "../../lib/marks.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { PushDialog } from "../tests/PushDialog.tsx";
import { TestEditor } from "../tests/TestEditor.tsx";
import { FixNote } from "./FixNote.tsx";
import { type QueueCounts, type QueueFilter, type QueueItem, type QueueSort, ReviewQueue } from "./ReviewQueue.tsx";
import { refKey } from "./ReviewStep.tsx";
import { type Marks, ReviewTest } from "./ReviewTest.tsx";
import { notAtAnchor, SourcePanel } from "./SourcePanel.tsx";

type Loaded = { id: string; test: Test; sync: SyncState; check: CheckFile | null; stale: boolean };
type Selection = { source: Source; step: number | null; label?: string } | null;

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const FILTER_STATES: Record<QueueFilter, string[] | undefined> = {
  all: undefined,
  checked: ["checked"],
  "to-fix": ["to-fix"],
};

export function ReviewScreen() {
  const app = useApp();
  const routeId = app.route.screen === "review" ? (app.route.arg ?? "") : "";
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [sort, setSort] = useState<QueueSort>("anomalies");
  const [folder, setFolder] = useState("");
  const [withFindings, setWithFindings] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [activeStep, setActiveStep] = useState(-1);
  const [sel, setSel] = useState<Selection>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [revertConflict, setRevertConflict] = useState<string | null>(null);
  const [claudeReady, setClaudeReady] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  const activeId = routeId || items?.[0]?.id || "";

  const loadQueue = useCallback(async () => {
    try {
      const r = await call<{ tests: QueueItem[]; counts: QueueCounts }>("review.queue", {
        ...(FILTER_STATES[filter] ? { state: FILTER_STATES[filter] } : {}),
        ...(folder ? { folder } : {}),
        ...(withFindings ? { withFindings: true } : {}),
        sort,
      });
      setItems(r?.tests ?? []);
      setCounts(r?.counts ?? null);
      return r?.tests ?? [];
    } catch (e) {
      setItems([]);
      errorToast(e, "Could not read the review queue");
      return [];
    }
  }, [filter, folder, withFindings, sort]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when a run or another screen changes the tests
  useEffect(() => {
    void loadQueue();
  }, [loadQueue, app.testsNonce, app.info?.dir]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the folder list comes from the whole queue, once per change
  useEffect(() => {
    call<{ tests: QueueItem[] }>("review.queue", {})
      .then((r) => setFolders([...new Set((r?.tests ?? []).map((t) => t.folder).filter(Boolean))].sort()))
      .catch(() => {});
  }, [app.testsNonce, app.info?.dir]);

  useEffect(() => {
    call<{ installed?: boolean; signedIn?: boolean | null }>("claude.status", {})
      .then((s) => setClaudeReady(!!s?.installed && s.signedIn !== false))
      .catch(() => {});
  }, []);

  const load = useCallback(async (id: string) => {
    const [show, chk] = await Promise.all([
      call<{ id: string; test: Test; sync?: SyncState }>("tests.show", { id }),
      call<{ check: CheckFile | null; stale: boolean }>("check.show", { id }).catch(() => ({
        check: null,
        stale: false,
      })),
    ]);
    const loaded: Loaded = {
      id,
      test: show.test,
      sync: show.sync ?? (show.test.key ? "synced" : "local"),
      check: chk?.check ?? null,
      stale: !!chk?.stale,
    };
    setData(loaded);
    setLoadError("");
    return loaded;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new test opens fresh; testsNonce reloads the same one
  useEffect(() => {
    if (!activeId) {
      setData(null);
      return;
    }
    let dead = false;
    if (data?.id !== activeId) {
      setData(null);
      setEditing(false);
      setFixOpen(false);
      setMarks(null);
      setSel(null);
      setActiveStep(-1);
    }
    load(activeId)
      .then((l) => {
        if (dead) return;
        if (data?.id === activeId) return;
        const fs = l.check?.findings ?? [];
        setFolded(new Set(l.test.steps.map((_, i) => i).filter((i) => !fs.some((f) => f.step === i + 1))));
        const first = l.test.steps.findIndex((s) => s.sources.length > 0);
        const fsrc = fs.find((f) => f.sources.length);
        if (fsrc) {
          const [docId, anchor] = fsrc.sources[0].split("#");
          setSel({ source: { docId, anchor: anchor ?? "", quote: "" }, step: fsrc.step ?? null });
        } else if (first >= 0) setSel({ source: l.test.steps[first].sources[0], step: first + 1 });
      })
      .catch((e) => !dead && setLoadError(message(e)));
    return () => {
      dead = true;
    };
  }, [activeId, app.testsNonce]);

  const { setFocus } = app;
  useEffect(() => {
    if (!data) return;
    setFocus({
      testId: data.id,
      key: data.test.key,
      summary: data.test.summary,
      step: activeStep >= 0 ? activeStep + 1 : null,
    });
  }, [setFocus, data, activeStep]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const lastRun = app.lastRun;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a run is consumed once, by its nonce
  useEffect(() => {
    if (!lastRun || !activeId) return;
    if (!lastRun.runId) {
      setMarks(null);
      return;
    }
    if (!lastRun.changedTests.includes(activeId) && !lastRun.changedSteps[activeId]) return;
    const before = data?.id === activeId ? data.test.steps.length : undefined;
    const steps = lastRun.changedSteps[activeId] ?? [];
    setMarks({ runId: lastRun.runId, steps: new Set(steps), added: addedSteps(steps, before) });
    setFolded((f) => new Set([...f].filter((i) => !steps.includes(i + 1))));
  }, [lastRun?.nonce]);

  const open = useCallback((id: string) => app.navigate("review", id), [app]);

  const move = useCallback(
    (dir: 1 | -1) => {
      if (!items?.length) return;
      const at = items.findIndex((t) => t.id === activeId);
      const next = items[Math.min(items.length - 1, Math.max(0, at + dir))];
      if (next && next.id !== activeId) open(next.id);
    },
    [items, activeId, open],
  );

  const afterDecision = async (id: string) => {
    const before = items ?? [];
    const at = before.findIndex((t) => t.id === id);
    const list = await loadQueue();
    app.refreshInfo();
    const next = list.find((t, i) => i >= at && t.id !== id) ?? list.filter((t) => t.id !== id).pop();
    if (next) open(next.id);
    else app.navigate("review");
  };

  const validate = async () => {
    if (!data || busy || fixOpen) return;
    setBusy(true);
    try {
      await flushEditor();
      await call("review.set", { id: data.id, decision: "validate" });
      toast({ kind: "ok", title: "Validated", detail: data.test.key ?? data.test.summary });
      await afterDecision(data.id);
    } catch (e) {
      errorToast(e, "Could not validate the test");
    } finally {
      setBusy(false);
    }
  };

  const markToFix = async (note: string, askClaude: boolean) => {
    if (!data) return;
    setBusy(true);
    try {
      await flushEditor();
      await call("review.set", { id: data.id, decision: "to-fix", note });
      setFixOpen(false);
      if (askClaude) {
        app.runInDock({ name: "review.fix", input: { id: data.id, note }, label: note, testId: data.id });
        await load(data.id);
        void loadQueue();
      } else {
        toast({ kind: "info", title: "Marked To fix", detail: data.test.key ?? data.test.summary });
        await afterDecision(data.id);
      }
    } catch (e) {
      errorToast(e, "Could not mark the test To fix");
    } finally {
      setBusy(false);
    }
  };

  const revert = async (force = false) => {
    if (!marks) return;
    try {
      await revertRun(marks.runId, force);
      setRevertConflict(null);
      setMarks(null);
      app.setLastRun({ runId: "", changedTests: [], changedSteps: {}, nonce: Date.now() });
      app.testsChanged();
      toast({ kind: "info", title: "Claude's changes reverted" });
    } catch (e) {
      if (!force && editedAfterRun(e)) setRevertConflict(message(e));
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  const takeJira = async () => {
    if (!data?.test.key) return;
    try {
      await run("xray.pull", { key: data.test.key, overwrite: true });
      toast({ kind: "ok", title: "Jira's version taken", detail: data.test.key });
      app.testsChanged();
    } catch (e) {
      errorToast(e, `Could not pull ${data.test.key}`);
    }
  };

  const stepSources = useMemo(() => {
    if (!data) return [] as { source: Source; step: number | null }[];
    const out: { source: Source; step: number | null }[] = [];
    const seen = new Set<string>();
    const add = (source: Source, step: number | null) => {
      const k = refKey(source) + (step ?? "");
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ source, step });
    };
    for (const f of data.check?.findings ?? [])
      if (!f.step)
        for (const r of f.sources) {
          const [docId, anchor] = r.split("#");
          if (anchor) add({ docId, anchor, quote: "" }, null);
        }
    data.test.steps.forEach((s, i) => {
      for (const src of s.sources) add(src, i + 1);
      for (const f of data.check?.findings ?? [])
        if (f.step === i + 1)
          for (const r of f.sources) {
            const [docId, anchor] = r.split("#");
            if (anchor) add({ docId, anchor, quote: "" }, i + 1);
          }
    });
    return out;
  }, [data]);

  const selectStep = useCallback(
    (i: number) => {
      if (!data) return;
      const n = Math.max(0, Math.min(data.test.steps.length - 1, i));
      setActiveStep(n);
      const own = stepSources.find((s) => s.step === n + 1);
      if (own) setSel(own);
      requestAnimationFrame(() =>
        body.current
          ?.querySelector(`[aria-label="Step ${n + 1}"]`)
          ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
      );
    },
    [data, stepSources],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || fixOpen || pushing) return;
      if (document.querySelector(".overlay")) return;
      const k = e.key.toLowerCase();
      if (k === "j") move(1);
      else if (k === "k") move(-1);
      else if (editing) return;
      else if (k === "v") void validate();
      else if (k === "f" && data) setFixOpen(true);
      else if (e.key === "ArrowDown" && data) selectStep(activeStep + 1);
      else if (e.key === "ArrowUp" && data) selectStep(activeStep - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const findings = data?.check?.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error").length;
  const selKey = sel ? refKey(sel.source) : "";
  const selIndex = sel ? stepSources.findIndex((s) => refKey(s.source) === selKey && s.step === sel.step) : -1;
  const running = !!data && app.claudeRunning === data.id;
  const waiting = counts ? counts.checked + counts.toFix + counts.draft : 0;

  return (
    <div className="screen">
      <ScreenHeader
        title="Review"
        meta={
          counts
            ? `${plural(waiting, "test")} waiting · ${counts.toFix} marked To fix${counts.unchecked ? ` · ${counts.unchecked} not checked yet` : ""}`
            : undefined
        }
      />
      <div className="review">
        <ReviewQueue
          items={items}
          counts={counts}
          activeId={activeId}
          filter={filter}
          sort={sort}
          folder={folder}
          folders={folders}
          withFindings={withFindings}
          onFilter={setFilter}
          onSort={setSort}
          onFolder={setFolder}
          onWithFindings={setWithFindings}
          onOpen={open}
        />
        <nav className="queue-strip" aria-label="Review queue, folded">
          <IconButton icon="up" label="Previous test (K)" disabled={!items?.length} onClick={() => move(-1)} />
          <span className="muted queue-strip-pos">
            {items?.length
              ? `${
                  Math.max(
                    0,
                    items.findIndex((t) => t.id === activeId),
                  ) + 1
                }/${items.length}`
              : "0"}
          </span>
          <IconButton icon="down" label="Next test (J)" disabled={!items?.length} onClick={() => move(1)} />
        </nav>
        <section className="review-main" aria-label="Test under review">
          {editing && data ? (
            <div className="review-edit">
              <div className="review-editbar">
                <span className="label">Editing</span>
                <span className="spacer" />
                <Button
                  size="sm"
                  tone="primary"
                  icon="check"
                  onClick={() => void flushEditor().then(() => setEditing(false))}
                >
                  Done editing
                </Button>
              </div>
              <TestEditor
                key={data.id}
                testId={data.id}
                onOpen={(id) => app.navigate("tests", id)}
                onSaved={() => {}}
              />
            </div>
          ) : (
            <div className="review-body" ref={body}>
              {loadError ? (
                <div className="problem" role="alert">
                  <Severity tone="error">This test could not be opened</Severity>
                  <p>{loadError}</p>
                </div>
              ) : !activeId ? (
                items && (
                  <div className="review-empty">
                    <Icon name="review" size={40} />
                    <h2 className="h">Nothing to review</h2>
                    <p className="muted">Generate tests or import a CSV: they come here once written and checked.</p>
                    <div className="review-empty-actions">
                      <Button tone="primary" onClick={() => app.navigate("generate")}>
                        Generate tests
                      </Button>
                      <Button tone="quiet" onClick={() => app.navigate("import")}>
                        Import a CSV
                      </Button>
                    </div>
                  </div>
                )
              ) : !data ? (
                <div className="rtest" role="status" aria-busy="true" aria-label="Loading the test">
                  <Skeleton w={260} h={12} />
                  <Skeleton w="70%" h={26} />
                  <Skeleton w={340} h={22} />
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="card rstep">
                      <Skeleton w={28} h={28} r={8} />
                      <Skeleton w="90%" h={13} />
                      <Skeleton w="75%" h={13} />
                      <Skeleton w="82%" h={13} />
                    </div>
                  ))}
                </div>
              ) : (
                <ReviewTest
                  test={data.test}
                  sync={data.sync}
                  check={data.check}
                  stale={data.stale}
                  xray={app.xray}
                  folded={folded}
                  activeStep={activeStep}
                  selected={selKey}
                  marks={marks}
                  claudeRunning={running}
                  url={(file) => fileUrl(`tests/${data.id}/${file}`)}
                  onFold={(i, f) => {
                    setFolded((cur) => {
                      const next = new Set(cur);
                      if (f) next.add(i);
                      else next.delete(i);
                      return next;
                    });
                    if (f && i === activeStep) setActiveStep(-1);
                  }}
                  onFoldAll={(f) => {
                    setFolded(f ? new Set(data.test.steps.map((_, i) => i)) : new Set());
                    if (f) setActiveStep(-1);
                  }}
                  onSelect={(source, step) => {
                    setSel({ source, step });
                    if (step) setActiveStep(step - 1);
                  }}
                  onOpenImage={(file) => window.open(fileUrl(`tests/${data.id}/${file}`), "_blank")}
                  onEdit={() => setEditing(true)}
                  onRevert={() => void revert()}
                  revertConflict={revertConflict}
                  fixMessage={
                    lastRun?.testId === data.id &&
                    lastRun.review &&
                    lastRun.review !== "checked" &&
                    lastRun.review === data.test.review
                      ? lastRun.message || "Claude's fix did not bring the test back to Checked."
                      : undefined
                  }
                  onRevertAnyway={() => void revert(true)}
                  onKeepAfterRun={() => setRevertConflict(null)}
                  onCompare={() => app.navigate("tests", data.id)}
                  onTakeJira={() => void takeJira()}
                  onKeepMine={() => setPushing(true)}
                />
              )}
            </div>
          )}
          {fixOpen && data && (
            <FixNote
              initial={data.test.review === "to-fix" ? (data.test.reviewNote ?? "") : ""}
              claudeReady={claudeReady}
              onCancel={() => setFixOpen(false)}
              onSubmit={(note, ask) => void markToFix(note, ask)}
            />
          )}
          <div className="review-foot">
            <div className="muted review-keys">
              <span>
                <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous test
              </span>
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> step
              </span>
            </div>
            <span className="spacer" />
            {errors > 0 && (
              <span
                className="review-open"
                title={`${plural(errors, "error")} still open${data?.stale ? " · out of date" : ""}`}
              >
                <Severity tone={data?.stale ? "stale" : "error"}>
                  {plural(errors, "error")}
                  <span className="review-open-long"> still open{data?.stale ? " · out of date" : ""}</span>
                </Severity>
              </span>
            )}
            <Button
              icon="edit"
              kbd="F"
              className={fixOpen ? "chip-on" : undefined}
              aria-expanded={fixOpen}
              disabled={!data || busy || running}
              onClick={() => setFixOpen((o) => !o)}
            >
              To fix
            </Button>
            <Button
              tone={fixOpen ? "secondary" : "primary"}
              icon="check"
              kbd="V"
              disabled={!data || busy || fixOpen || running}
              onClick={() => void validate()}
            >
              Validate
            </Button>
          </div>
        </section>
        {!editing && (
          <SourcePanel
            source={sel?.source ?? null}
            label={
              sel
                ? (sel.label ?? (sel.step ? `Source of step ${sel.step}` : "Source of the whole-test finding"))
                : "Source"
            }
            index={Math.max(0, selIndex)}
            total={stepSources.length}
            testId={data?.id ?? ""}
            misplaced={sel ? notAtAnchor(findings, selKey, sel.step) : undefined}
            onOpenDoc={(docId, anchor) => app.navigate("documents", `${docId}#${anchor}`)}
            onPick={(ref) => {
              const at = ref.indexOf("#");
              const own = stepSources.find((s) => refKey(s.source) === ref);
              setSel(
                own ?? {
                  source: { docId: ref.slice(0, at), anchor: ref.slice(at + 1), quote: "" },
                  step: null,
                  label: "Related to this test",
                },
              );
            }}
          />
        )}
      </div>
      {pushing && data && (
        <PushDialog
          testId={data.id}
          testKey={data.test.key}
          summary={data.test.summary}
          review={data.test.review}
          onDone={() => {
            setPushing(false);
            app.testsChanged();
          }}
          onClose={() => setPushing(false)}
          onCompare={() => app.navigate("tests", data.id)}
        />
      )}
    </div>
  );
}
