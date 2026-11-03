import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ColumnModes,
  Folder,
  LocalTestRef,
  Precondition,
  Step,
  StepImage,
  SyncState,
  Test,
} from "../../../core/types.ts";
import { call, fileUrl, project, run } from "../../api.ts";
import { CONTEXTS_EVENT, ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { RevertConflict } from "../../components/claude/RevertConflict.tsx";
import { Button, Confirm, DragEdge, Icon, type MenuItem, Segmented, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { blankStep } from "../../lib/blocks.ts";
import { columnsOf, projectModes } from "../../lib/columns.ts";
import { openExternal } from "../../lib/desktop.ts";
import { differs, diffLocal, type Gone, lossOf, restoreStep } from "../../lib/diff.ts";
import { setDiscarder, setFlusher } from "../../lib/editorBus.ts";
import { DEFAULT_XRAY } from "../../lib/fields.ts";
import { uploadImage } from "../../lib/files.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { addedSteps } from "../../lib/marks.ts";
import { addRecent, renameRecent } from "../../lib/recent.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { readPref, readString, writePref } from "../../lib/theme.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { ColumnsMenu } from "./ColumnsMenu.tsx";
import { DeleteTest } from "./DeleteTest.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { PushDialog } from "./PushDialog.tsx";
import { StepCard, type StepLayout } from "./StepCard.tsx";
import { type ContextRef, type RemoteCheck, type TestContexts, TestHeader } from "./TestHeader.tsx";
import { GoneStep } from "./WasView.tsx";

export type TestShow = {
  id: string;
  test: Test;
  warnings?: string[];
  remote?: Test | null;
  sync?: SyncState;
  files?: string[];
  mtime?: number;
};

type Mark = "changed" | "added";
type Dialog =
  | { kind: "download" }
  | { kind: "undo" }
  | { kind: "delete" }
  | { kind: "restore"; base: Step; gone: Gone | null; n: number }
  | { kind: "contexts" };

const LAYOUTS: StepLayout[] = ["stacked", "split"];
const MIN_WIDTH = 560;

// ponytail: what Jira holds for the project (its preconditions, its folder tree) changes rarely and is
// asked once per project and session — a failed answer is forgotten so the next test asks again
const preCache = new Map<string, Promise<Precondition[]>>();
const folderCache = new Map<string, Promise<string[]>>();

const cached = <T,>(m: Map<string, Promise<T>>, ask: () => Promise<T>): Promise<T> => {
  const k = project() ?? "";
  let p = m.get(k);
  if (!p) {
    p = ask();
    m.set(k, p);
    p.catch(() => m.delete(k));
  }
  return p;
};

const flatten = (f: Folder): string[] => [f.path, ...f.folders.flatMap(flatten)];

const readWidth = (): number | null => {
  const n = Number(readString("testimus.editorWidth"));
  return Number.isFinite(n) && n >= MIN_WIDTH ? n : null;
};

export function TestEditor({
  testId,
  onSaved,
  onOpen,
}: {
  testId: string;
  onSaved: (ref: Partial<LocalTestRef> & { id: string }) => void;
  onOpen: (id: string) => void;
}) {
  const app = useApp();
  const jiraKey = app.info?.project.jiraProject ?? "";
  const xray = app.xray ?? DEFAULT_XRAY;
  const [test, setTest] = useState<Test | null>(null);
  const [remote, setRemote] = useState<Test | null>(null);
  const [files, setFiles] = useState<Set<string>>(new Set());
  const [sync, setSync] = useState<SyncState>("local");
  const [check, setCheck] = useState<RemoteCheck>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [layout, setLayout] = useState<StepLayout>(() => readPref("testimus.stepLayout", LAYOUTS, "stacked"));
  const [details, setDetails] = useState(() => readPref("testimus.showDetails", ["1", "0"], "1") === "1");
  const [width, setWidth] = useState<number | null>(readWidth);
  const [focus, setFocusStep] = useState(-1);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [marks, setMarks] = useState<{ runId: string; byUid: Map<number, Mark> } | null>(null);
  const [drag, setDrag] = useState(-1);
  const [dropAt, setDropAt] = useState(-1);
  const [lb, setLb] = useState<{ images: StepImage[]; index: number; step: number } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyDl, setBusyDl] = useState(false);
  const [preconditions, setPreconditions] = useState<Precondition[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [contexts, setContexts] = useState<ContextRef[]>([]);
  const [testCtx, setTestCtx] = useState<TestContexts | null>(null);
  const [testCols, setTestCols] = useState<ColumnModes | null>(null);

  const current = useRef<Test | null>(null);
  const loadedFor = useRef("");
  const gen = useRef(0);
  const mtime = useRef(0);
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
      const ref = await call<LocalTestRef & { mtime?: number }>("tests.save", { id: p.id, test: p.test });
      if (ref && loadedFor.current === p.id) {
        if (ref.sync) setSync(ref.sync);
        if (ref.mtime) mtime.current = ref.mtime;
      }
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
    gen.current++;
    current.current = t;
    loadedFor.current = id;
    mtime.current = r.mtime ?? 0;
    setTest(t);
    setRemote(r.remote ?? null);
    setFiles(new Set(r.files ?? []));
    setSync(r.sync ?? (t.key ? "synced" : "local"));
    setError("");
    return { test: t, remote: r.remote ?? null };
  }, []);

  // ponytail: the remote re-check runs on every open of a pushed test — « we can't fully trust the local » —
  // and its answer lives until the next open; a network failure only says « not verified »
  const recheck = useCallback(async (id: string) => {
    setCheck("checking");
    try {
      const r = await call<{ tests: { id: string; sync: SyncState; remote: RemoteCheck }[] }>("xray.status", { id });
      const one = r.tests?.[0];
      if (loadedFor.current !== id) return;
      setCheck(one?.remote ?? "unverified");
      if (one) {
        setSync(one.sync);
        savedRef.current({ id, sync: one.sync });
      }
    } catch {
      if (loadedFor.current === id) setCheck("unverified");
    }
  }, []);

  useEffect(() => {
    let dead = false;
    setTest(null);
    setMarks(null);
    setFolded(new Set());
    setFocusStep(-1);
    setSaving("idle");
    setCheck(null);
    setTestCtx(null);
    setTestCols(null);
    setDialog(null);
    load(testId)
      .then(({ test: t, remote: base }) => {
        if (dead) return;
        addRecent(testId);
        if (t.key && base) void recheck(testId);
      })
      .catch((e) => {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      });
    call<TestContexts>("contexts.ofTest", { testId })
      .then((c) => !dead && setTestCtx(c))
      .catch(() => {});
    call<{ own: ColumnModes | null }>("tests.columns", { id: testId })
      .then((c) => !dead && setTestCols(c.own))
      .catch(() => {});
    return () => {
      dead = true;
      void flush();
    };
  }, [testId, load, flush, recheck]);

  useEffect(() => {
    let dead = false;
    if (jiraKey) {
      cached(preCache, () => call<Precondition[]>("xray.preconditions", {}))
        .then((p) => !dead && setPreconditions(p ?? []))
        .catch((e) => {
          if (dead) return;
          setPreconditions([]);
          errorToast(e, "Could not load the preconditions from Jira");
        });
    } else setPreconditions([]);
    const contextsNow = () =>
      call<ContextRef[]>("contexts.list", {})
        .then((c) => !dead && setContexts(c ?? []))
        .catch(() => {});
    void contextsNow();
    window.addEventListener(CONTEXTS_EVENT, contextsNow);
    return () => {
      dead = true;
      window.removeEventListener(CONTEXTS_EVENT, contextsNow);
    };
  }, [jiraKey]);

  useEffect(() => {
    const own = () =>
      call<TestContexts>("contexts.ofTest", { testId })
        .then((c) => loadedFor.current === testId && setTestCtx(c))
        .catch(() => {});
    window.addEventListener(CONTEXTS_EVENT, own);
    return () => window.removeEventListener(CONTEXTS_EVENT, own);
  }, [testId]);

  // ponytail: any Claude run locks the editor (Xray Editor) — a project run may write this test.md too
  const busy = !!app.claudeRunning;
  const busyHere = app.claudeRunning === testId;

  // ponytail: the user may have edited test.md in a terminal or with Claude Code — on window focus the
  // file's own mtime says whether to reload; a pending edit is saved first, so nothing typed is lost
  useEffect(() => {
    const onFocus = async () => {
      if (!loadedFor.current || busy) return;
      await flush();
      try {
        const r = await call<TestShow>("tests.show", { id: loadedFor.current });
        if (r.mtime && mtime.current && r.mtime !== mtime.current && loadedFor.current === r.id) {
          await load(r.id);
          setMarks(null);
          app.testsChanged();
          toast({ kind: "info", title: "Reloaded from disk", detail: "test.md was changed outside the app." });
        }
      } catch (e) {
        errorToast(e, "Could not reload the test");
      }
    };
    const onFocusEvt = () => void onFocus();
    window.addEventListener("focus", onFocusEvt);
    return () => window.removeEventListener("focus", onFocusEvt);
  }, [flush, load, busy, app.testsChanged]);

  useEffect(() => {
    setFlusher(flush);
    setDiscarder((id) => {
      if (pending.current?.id === id) {
        pending.current = null;
        clearTimeout(timer.current);
      }
      if (loadedFor.current === id) loadedFor.current = "";
    });
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    return () => {
      setFlusher(null);
      setDiscarder(null);
      window.removeEventListener("blur", onBlur);
    };
  }, [flush]);

  const { setFocus } = app;
  useEffect(() => {
    if (!test) return;
    setFocus({ testId, key: test.key, summary: test.summary, step: focus >= 0 ? focus + 1 : null });
  }, [setFocus, testId, test, focus]);
  useEffect(() => () => setFocus(null), [setFocus]);

  // ponytail: the Xray folder tree is asked for when the folder picker opens (Xray Editor), once per project and
  // session; a failure is said each time and the next opening asks again
  const loadFolders = () => {
    if (!jiraKey) return;
    cached(folderCache, () => call<Folder>("xray.folders", {}).then(flatten))
      .then(setFolders)
      .catch((e) => errorToast(e, "Could not load the Xray folders"));
  };

  const lastRun = app.lastRun;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a run is consumed once, by its nonce
  useEffect(() => {
    // ponytail: a run on this test reloads it even when it reports no change (Xray Editor always reads the file back)
    if (!lastRun || !(lastRun.changedTests.includes(testId) || lastRun.testId === testId)) return;
    const before = loadedFor.current === testId ? current.current?.steps.length : undefined;
    load(testId)
      .then(({ test: t }) => {
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
    timer.current = setTimeout(() => void flush(), 400);
  };

  // ponytail: a card edits its step by identity, not by position — an Undo that lands after a move, or
  // a toast that outlived a drag, still finds the step it was made for
  const patchByUid = (uid: number, fn: (s: Step) => Step) => {
    setMarks((m) => (m?.byUid.has(uid) ? { ...m, byUid: new Map([...m.byUid].filter(([k]) => k !== uid)) } : m));
    update((t) => ({
      ...t,
      steps: t.steps.map((s) => {
        if (uidOf(s) !== uid) return s;
        const next = fn(s);
        uids.current.map.set(next, uid);
        return next;
      }),
    }));
  };

  const alive = () => {
    const g = gen.current;
    const id = testId;
    return () => gen.current === g && loadedFor.current === id;
  };

  const widthRef = useRef(width);
  widthRef.current = width;
  const commitWidth = () => writePref("testimus.editorWidth", String(widthRef.current ?? ""));

  const imageGone = (file: string) => {
    const id = testId;
    void flush()
      .then(() => call("tests.removeImage", { id, file }))
      .catch(() => {});
  };

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
    requestAnimationFrame(() =>
      (document.querySelector(`[data-step="${j}"] textarea, [data-step="${j}"] input`) as HTMLElement | null)?.focus(),
    );
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
    const ok = alive();
    update((t) => ({ ...t, steps: t.steps.filter((_, k) => k !== i) }));
    // ponytail: the ring moves to the step that takes the deleted one's place (Xray Editor)
    setFocusStep((f) => (f < 0 ? f : Math.min(f, (current.current?.steps.length ?? 1) - 1)));
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
          update((t) => ({ ...t, steps: [...t.steps.slice(0, i), removed, ...t.steps.slice(i)] }));
        },
      },
    });
  };

  const revertClaude = async (force = false) => {
    if (!marks) return;
    try {
      // ponytail: a pending edit is saved before the revert reads the file (Xray Editor)
      await flush();
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

  const refuseWhileClaude = () => {
    if (!busy) return false;
    toast({ kind: "info", title: "Wait for Claude to finish", detail: "This test is being edited right now." });
    return true;
  };

  const askPush = async () => {
    if (refuseWhileClaude()) return;
    await flush();
    setPushing(true);
  };

  const askDownload = async () => {
    if (refuseWhileClaude() || !test?.key) return;
    await flush();
    try {
      const r = await call<TestShow>("tests.show", { id: testId });
      const local = r.remote ? differs(r.test, r.remote) : true;
      if (local) setDialog({ kind: "download" });
      else void download();
    } catch (e) {
      errorToast(e, "Could not read the test");
    }
  };

  const download = async () => {
    const key = test?.key;
    // ponytail: a run may have started while the dialog was open — checked again on confirm (Xray Editor)
    if (!key || refuseWhileClaude()) return setDialog(null);
    setBusyDl(true);
    const id = testId;
    try {
      pending.current = null;
      const r = await run<{ pulled: string[]; failed: { key: string; error: string }[] }>("xray.pull", {
        key,
        overwrite: true,
      });
      if (r.failed?.length) throw new Error(r.failed[0].error);
      app.testsChanged();
      if (loadedFor.current === id) {
        await load(id);
        setMarks(null);
        setCheck("unchanged");
      }
      toast({ kind: "ok", title: `${key} refreshed from Jira` });
    } catch (e) {
      errorToast(e, `Could not download ${key}`);
    } finally {
      setBusyDl(false);
      setDialog(null);
    }
  };

  const undoLocal = async () => {
    if (refuseWhileClaude()) return setDialog(null);
    try {
      pending.current = null;
      clearTimeout(timer.current);
      const ref = await call<LocalTestRef>("tests.restore", { id: testId });
      await load(testId);
      setMarks(null);
      if (ref) savedRef.current(ref);
      toast({ kind: "ok", title: "Restored the Jira version", detail: "From the last sync — nothing was downloaded." });
    } catch (e) {
      errorToast(e, "Could not undo the local changes");
    } finally {
      setDialog(null);
    }
  };

  const openInJira = async (key: string) => {
    try {
      const { url } = await call<{ url: string }>("xray.browse", { key });
      if (!openExternal(url)) window.open(url, "_blank", "noopener");
    } catch (e) {
      errorToast(e, `Could not open ${key}`);
    }
  };

  const clone = async () => {
    await flush();
    try {
      const r = await call<{ id: string }>("tests.clone", { id: testId });
      app.testsChanged();
      onOpen(r.id);
      toast({ kind: "ok", title: "Cloned", detail: "The copy is a new local test." });
    } catch (e) {
      errorToast(e, "Could not clone the test");
    }
  };

  const askDelete = async () => {
    if (refuseWhileClaude() || !test) return;
    await flush();
    // ponytail: from the editor's menu it always asks (Xray Editor); the sidebar's ✕ asks only when it matters
    setDialog({ kind: "delete" });
  };

  const setTestContexts = async (ids: string[] | null) => {
    try {
      setTestCtx(await call<TestContexts>("contexts.setTest", { testId, contexts: ids }));
      window.dispatchEvent(new Event(CONTEXTS_EVENT));
    } catch (e) {
      errorToast(e, "Could not change the contexts of this test");
    }
  };

  const setProjectModes = async (modes: ColumnModes) => {
    const names = (m: string) =>
      Object.entries(modes)
        .filter(([, v]) => v === m)
        .map(([k]) => k);
    try {
      const open = names("open");
      await call("xray.prefs", {
        collapsed: names("collapsed"),
        filled: names("filled"),
        ...(open.length || xray.prefs.open?.length ? { open } : {}),
      });
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Could not save the column settings");
    }
  };

  const setTestModes = async (modes: ColumnModes | null) => {
    try {
      const r = await call<{ own: ColumnModes | null }>("tests.setColumns", { id: testId, modes });
      setTestCols(r.own);
    } catch (e) {
      errorToast(e, "Could not save the column settings of this test");
    }
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
          <div className="editor-col">
            <Skeleton w="100%" h={46} r={12} />
            <Skeleton w="100%" h={160} r={12} />
            <Skeleton w="100%" h={46} r={12} />
          </div>
        </div>
      </div>
    );

  const url = (file: string) => fileUrl(`tests/${testId}/${file}`);
  const markOf = (s: Step) => marks?.byUid.get(uidOf(s));
  const claudeMarked = test.steps.map((s, i) => ({ m: markOf(s), i })).filter((x) => x.m);
  const dirty = remote ? differs(test, remote) : !test.key;
  const diff = remote && dirty ? diffLocal(test.steps, remote.steps) : null;
  const pModes = projectModes(xray);
  const cols = columnsOf(xray, {
    fields: Object.fromEntries(test.steps.flatMap((s) => Object.entries(s.fields))),
    sources: [],
    images: [],
  });
  // ponytail: nothing local to send — the test matches its last sync, even if Jira changed since (Xray Editor)
  const canPush = !(!!remote && !!test.key && !dirty);
  const openImage = (file: string, images: StepImage[], step: number) =>
    setLb({
      images,
      step,
      index: Math.max(
        0,
        images.findIndex((im) => im.file === file),
      ),
    });
  const askRestore = (base: Step, gone: Gone | null, n: number) => {
    if (refuseWhileClaude()) return;
    setDialog({ kind: "restore", base, gone, n });
  };

  const menu: MenuItem[] = [
    { key: "clone", label: "Clone", icon: "clone", onSelect: () => void clone() },
    ...(test.key
      ? [
          {
            key: "download",
            label: "Download from Jira",
            icon: "pull" as const,
            title: "Fetch what Jira has right now and overwrite the local file",
            disabled: busyDl,
            onSelect: () => void askDownload(),
          },
        ]
      : []),
    ...(remote && dirty
      ? [
          {
            key: "undo",
            label: "Undo local changes",
            icon: "revert" as const,
            title: "Back to the last synced version, from the local snapshot — no network, nothing pushed",
            onSelect: () => !refuseWhileClaude() && setDialog({ kind: "undo" }),
          },
        ]
      : []),
    { kind: "sep", key: "s1" },
    ...(test.key
      ? [
          {
            key: "jira",
            label: "Open in Jira ↗",
            icon: "external" as const,
            title: `Open ${test.key} in the browser`,
            onSelect: () => void openInJira(test.key as string),
          },
        ]
      : []),
    { kind: "sep", key: "s2" },
    { key: "delete", label: "Delete local copy", icon: "trash", danger: true, onSelect: () => void askDelete() },
  ];

  const gones = diff?.gone ?? [];
  const goneAt = (i: number) => gones.filter((g) => g.at === i);
  const goneCard = (g: Gone, k: number) => (
    <div key={`gone:${g.step.id ?? k}`} className="step-slot">
      <GoneStep
        step={g.step}
        xray={xray}
        layout={layout}
        url={url}
        onOpenImage={(file, images) => openImage(file, images, 0)}
        onRestore={busy ? undefined : () => askRestore(g.step, g, test.steps.length)}
      />
    </div>
  );

  const loss = remote ? lossOf(test, remote) : null;
  const restoreMissing = dialog?.kind === "restore" ? dialog.base.images.filter((im) => !files.has(im.file)).length : 0;

  return (
    <div
      className="editor"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) void flush();
      }}
    >
      <TestHeader
        test={test}
        sync={sync}
        dirty={dirty}
        remote={check}
        saving={saving}
        activity={busyDl ? "Refreshing from Jira…" : undefined}
        folders={[...new Set([...folders, ...(app.info?.project.folders ?? [])])].sort()}
        onFolders={loadFolders}
        readOnly={busy}
        details={details}
        preconditions={preconditions}
        contexts={contexts}
        testContexts={testCtx}
        canPush={canPush}
        pushing={pushing}
        menu={menu}
        onDetails={(v) => {
          setDetails(v);
          writePref("testimus.showDetails", v ? "1" : "0");
        }}
        onPush={() => void askPush()}
        onAsk={() => app.askClaude("test")}
        onRemote={() => void askDownload()}
        onContexts={(ids) => void setTestContexts(ids)}
        onManageContexts={() => setDialog({ kind: "contexts" })}
        update={update}
      />
      <div className="editor-scroll" inert={busy}>
        <div className="editor-col" style={width ? { maxWidth: width } : undefined}>
          <DragEdge
            className="col-edge col-edge-l"
            label="Resize the editor column"
            target={(edge) => edge.parentElement as HTMLElement}
            width={(dx, w, el) => Math.max(MIN_WIDTH, Math.min(w - 2 * dx, (el.parentElement?.clientWidth ?? w) - 24))}
            onWidth={setWidth}
            onCommit={commitWidth}
            onReset={() => {
              setWidth(null);
              writePref("testimus.editorWidth", "");
            }}
          />
          <DragEdge
            className="col-edge col-edge-r"
            label="Resize the editor column"
            target={(edge) => edge.parentElement as HTMLElement}
            width={(dx, w, el) => Math.max(MIN_WIDTH, Math.min(w + 2 * dx, (el.parentElement?.clientWidth ?? w) - 24))}
            onWidth={setWidth}
            onCommit={commitWidth}
            onReset={() => {
              setWidth(null);
              writePref("testimus.editorWidth", "");
            }}
          />
          {busy && (
            <div className="banner" role="status">
              <span className="dot banner-dot" />
              <p>
                {busyHere ? "Claude is working on this test." : "Claude is working."} Editing is paused until it
                finishes.
              </p>
            </div>
          )}
          {marks && (
            <div className="banner" role="status">
              <Icon name="claude" />
              <p>
                {claudeMarked.length > 0 ? (
                  <>
                    <strong>Claude changed {plural(claudeMarked.length, "step")}</strong> —{" "}
                    {claudeMarked.map((x) => `step ${x.i + 1}${x.m === "added" ? " (new)" : ""}`).join(", ")}.
                  </>
                ) : (
                  <strong>Claude changed this test.</strong>
                )}{" "}
                The test goes back through the check before review.
              </p>
              {claudeMarked.length > 0 && (
                <Button size="sm" onClick={showChanges}>
                  Show changes
                </Button>
              )}
              <Button size="sm" icon="revert" onClick={() => void revertClaude()}>
                Revert all
              </Button>
            </div>
          )}
          {marks && conflict && (
            <RevertConflict
              detail={conflict}
              onForce={() => void revertClaude(true)}
              onKeep={() => setConflict(null)}
            />
          )}
          {test.preconditions.length > 0 && (
            <div className="precond-list">
              {test.preconditions.map((k) => {
                const p = preconditions?.find((x) => x.key === k);
                return (
                  <div key={k} className="precond">
                    <Icon name="lock" />
                    <div className="precond-body">
                      <div className="precond-head">
                        <span className="label">Precondition</span>
                        <button
                          type="button"
                          className="chip chip-sm precond-key mono"
                          title={`Open ${k} in the browser`}
                          onClick={() => void openInJira(k)}
                        >
                          {k}
                          <Icon name="external" size={10} />
                        </button>
                        <span className="precond-summary">
                          {p?.summary ?? (preconditions === null ? "loading…" : "not loaded")}
                        </span>
                        <span className="muted precond-note">read-only · lives in Jira</span>
                      </div>
                      {p?.definition && <div className="precond-def">{p.definition}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="steps-head">
            <h2 className="h">Steps</h2>
            <span className="muted">{test.steps.length}</span>
            <div className="spacer" />
            <ColumnsMenu
              columns={cols}
              projectModes={pModes}
              testModes={testCols}
              onProject={(m) => void setProjectModes(m)}
              onTest={(m) => void setTestModes(m)}
            />
            <Segmented
              label="Step layout"
              value={layout}
              onChange={(l) => {
                setLayout(l);
                writePref("testimus.stepLayout", l);
              }}
              options={[
                { value: "stacked", label: "Stacked" },
                { value: "split", label: "Action | Expected" },
              ]}
            />
          </div>
          {goneAt(-1).map(goneCard)}
          {test.steps.flatMap((s, i) => {
            const uid = uidOf(s);
            const m = markOf(s);
            const dm = diff?.marks[i];
            const before = dm === "modified" ? remote?.steps.find((b) => b.id === s.id) : undefined;
            return [
              <div key={`${testId}:${uid}`} className="step-slot" data-step={i}>
                {drag >= 0 && dropAt === i && <div className="dropline" />}
                <StepCard
                  index={i}
                  count={test.steps.length}
                  step={s}
                  xray={xray}
                  layout={layout}
                  projectModes={pModes}
                  testModes={testCols}
                  claude={!!m}
                  added={m === "added"}
                  mark={dm === "same" ? undefined : dm}
                  before={before}
                  folded={folded.has(uid)}
                  dragging={drag === i}
                  focused={focus === i && drag < 0}
                  url={url}
                  addImage={(f) => uploadImage(testId, f)}
                  alive={alive}
                  onChange={(fn) => patchByUid(uid, fn)}
                  onImageGone={imageGone}
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
                  onAsk={() => {
                    setFocusStep(i);
                    setFocus({ testId, key: test.key, summary: test.summary, step: i + 1 });
                    app.askClaude("step");
                  }}
                  onRestore={(b) => askRestore(b, null, i + 1)}
                  onOpenImage={(file, images) => openImage(file, images, i + 1)}
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
              </div>,
              ...goneAt(i).map(goneCard),
            ];
          })}
          {drag >= 0 && dropAt === test.steps.length && <div className="dropline" />}
          {test.steps.length === 0 ? (
            <div className="steps-empty">
              <p>
                <strong>This test has no steps yet.</strong>
              </p>
              <p className="muted">A step is Action, Data and Expected Result, plus any screenshots you paste in.</p>
              <Button tone="primary" icon="plus" onClick={() => insertStep(0)}>
                Add first step
              </Button>
            </div>
          ) : (
            <button type="button" className={cx("add-step")} onClick={() => insertStep(test.steps.length)}>
              <Icon name="plus" />
              Add step
            </button>
          )}
        </div>
      </div>
      {pushing && (
        <PushDialog
          testId={testId}
          testKey={test.key}
          summary={test.summary}
          review={test.review}
          onClose={() => {
            setPushing(false);
            void load(testId)
              .then(() => app.testsChanged())
              .catch(() => {});
          }}
          onDone={(id) => {
            setPushing(false);
            app.testsChanged();
            if (id !== testId) {
              renameRecent(testId, id);
              onOpen(id);
            } else void load(testId).catch((e) => errorToast(e, "Could not reload the test"));
          }}
        />
      )}
      {lb && lb.images.length > 0 && (
        <Lightbox
          names={lb.images.map((im) => im.file.split("/").pop() ?? im.file)}
          urls={lb.images.map((im) => url(im.file))}
          index={Math.min(lb.index, lb.images.length - 1)}
          step={lb.step}
          onIndex={(index) => setLb({ ...lb, index })}
          onClose={() => setLb(null)}
        />
      )}
      {dialog?.kind === "download" && (
        <Confirm
          title="Download from Jira?"
          confirm="Overwrite local"
          danger
          busy={busyDl}
          loss={
            <>
              <strong>Local changes that will be lost: </strong>
              {remote ? "everything you edited since the last sync." : "this test was never pushed."}
            </>
          }
          onClose={() => setDialog(null)}
          onConfirm={() => void download()}
        >
          <p>
            You have local changes to <span className="mono">{test.key}</span> that have not been pushed. Downloading
            fetches the test as Jira has it right now and replaces the local test.md with it.
          </p>
        </Confirm>
      )}
      {dialog?.kind === "undo" && loss && (
        <Confirm
          title="Undo every local change?"
          confirm="Undo local changes"
          danger
          loss={
            <>
              <strong>Lost: </strong>
              {loss.modified} modified · {loss.added} added · {loss.deleted} deleted step(s), plus any edit to the
              header fields.
            </>
          }
          onClose={() => setDialog(null)}
          onConfirm={() => void undoLocal()}
        >
          <p>
            test.md goes back to the version of the last sync with Jira, from the local snapshot — nothing is
            downloaded, nothing is pushed.
          </p>
        </Confirm>
      )}
      {dialog?.kind === "restore" && (
        <Confirm
          title={dialog.gone ? "Bring the deleted step back?" : `Restore step ${dialog.n} from Jira?`}
          confirm={dialog.gone ? "Bring the step back" : "Restore this step"}
          loss={
            restoreMissing > 0
              ? `Screenshots no longer in the project: ${restoreMissing} of them — the embed comes back, the picture only after a Download from Jira.`
              : undefined
          }
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
        >
          <p>
            {dialog.gone
              ? "The step comes back where it was deleted, as Jira had it at the last sync."
              : "Its fields and screenshots are replaced by what Jira had at the last sync."}
          </p>
        </Confirm>
      )}
      {dialog?.kind === "delete" && (
        <DeleteTest
          target={{
            id: testId,
            key: test.key,
            summary: test.summary,
            synced: !!remote,
            dirty,
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
            call<ContextRef[]>("contexts.list", {})
              .then((c) => setContexts(c ?? []))
              .catch(() => {});
            call<TestContexts>("contexts.ofTest", { testId })
              .then(setTestCtx)
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
