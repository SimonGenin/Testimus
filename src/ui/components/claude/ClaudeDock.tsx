import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeAction,
  ClaudeEvent,
  ClaudeResult,
  ClaudeScope,
  Diagnosis,
  Effort,
  JobEvent,
  Source,
  Tokens,
} from "../../../core/types.ts";
import { ApiError, call, run } from "../../api.ts";
import { type Action, actionsChanged, useActions } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { flushEditor } from "../../lib/editorBus.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Badge, Button, Icon, Kbd, Segmented, SourceChip } from "../ui/index.ts";
import { ActionButton } from "./ActionButton.tsx";
import { ActionCard } from "./ActionCard.tsx";
import { AdditionalContext } from "./AdditionalContext.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { type ClaudeStatus, ConnectClaude } from "./ConnectClaude.tsx";
import { CONTEXTS_EVENT } from "./ContextsDialog.tsx";
import { EFFORTS, ModelPicker } from "./ModelPicker.tsx";
import { OnTopToggle } from "./OnTopToggle.tsx";

type Mode = "docs" | "test";
type Kind = "step" | "test" | "doc" | "project";

type Meta = { durationMs: number; tokens?: Tokens; sessionId?: string; model: string; effort: Effort };
type Again = {
  mode: Mode;
  text: string;
  scope?: ClaudeScope;
  contexts?: string[];
  note?: string;
  label?: string;
  model: string;
  effort: Effort;
};

type Turn = {
  id: number;
  role: "user" | "assistant";
  kind?: "run" | "chat";
  text: string;
  tools: { label: string; done: boolean }[];
  running?: boolean;
  label?: string;
  testId?: string;
  sources?: Source[];
  trouble?: Diagnosis | { title: string; detail: string };
  run?: {
    runId: string;
    testId: string;
    docId?: string;
    steps: number;
    tests: number;
    files?: number;
    reverted?: boolean;
    review?: string;
  };
  note?: string;
  meta?: Meta;
  raw?: string;
  showRaw?: boolean;
  again?: Again;
  action?: ClaudeAction;
  ready?: boolean;
  pick?: { model: string; effort: Effort };
};

// ponytail: review.fix re-checks in the same job — it says whether the test went back to checked, and why not
export function fixOutcome(r: { review?: string; message?: string }): { word: string; note?: string } {
  if (!r.review) return { word: "check queued" };
  if (r.review === "checked") return { word: "checked again" };
  return { word: "still To fix", note: r.message || "The test did not go back to Checked." };
}

// ponytail: a run with no test (the whole project) still marks Claude as running, so every editor locks
export const PROJECT_RUN = "*project*";

const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function metaLine(m: Meta): string {
  return [
    `${(m.durationMs / 1000).toFixed(1)} s`,
    m.tokens ? `${kilo(m.tokens.input)} tokens in · ${kilo(m.tokens.output)} out` : "no tokens reported",
    `${m.model || "default"} / ${m.effort}`,
    m.sessionId ? `session ${m.sessionId.slice(0, 8)}…` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

type RunResult = ClaudeResult & {
  runId?: string;
  changedSteps?: Record<string, number[]>;
  changedFiles?: string[];
  review?: string;
  message?: string;
  action?: ClaudeAction;
};
type ChatResult = {
  chatId: string;
  ok?: boolean;
  answer: string;
  sources?: Source[];
  diagnosis?: Diagnosis;
  tokens?: Tokens;
  sessionId?: string;
};

export function toolLabel(name: string, input: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(input) as Record<string, unknown>;
  } catch {}
  const short = name.replace(/^mcp__testimus__/, "").replace(/_/g, ".");
  const q = typeof args.query === "string" ? args.query : typeof args.question === "string" ? args.question : "";
  if (/search/i.test(short) && q) return `Searched the documents for “${q}”`;
  if (/passage/i.test(short) && typeof args.docId === "string")
    return `Read ${args.docId} ${String(args.anchor ?? "")}`;
  if (/^(Read|Glob|Grep)$/.test(name)) return `Read ${String(args.file_path ?? args.pattern ?? "")}`.trim();
  if (/^(Edit|Write|MultiEdit)$/.test(name))
    return `Edited ${String(args.file_path ?? "a file")
      .split(/[\\/]/)
      .slice(-2)
      .join("/")}`;
  return `Used ${short}`;
}

// ponytail: an action's scope is the dock's scope — several tests are worked on from the project
export function kindOf(s: ClaudeScope): Kind {
  if (s.kind === "step" || s.kind === "test" || s.kind === "doc") return s.kind;
  return "project";
}

export const docOfRoute = (r: { screen: string; arg?: string }): string | null =>
  r.screen === "documents" && r.arg ? r.arg.split("#")[0] || null : null;

let seq = 0;

export type DockJob = { name: string; input: unknown; label: string; testId: string };
export type DockRequest = {
  mode: Mode;
  scope?: "test" | "step" | "project";
  prompt?: string;
  job?: DockJob;
  actions?: ClaudeAction[];
  nonce: number;
};

export function ClaudeDock({
  folded,
  request,
  onFold,
}: {
  folded: boolean;
  request?: DockRequest | null;
  onFold: () => void;
}) {
  const app = useApp();
  const focus = app.focus;
  const docId = docOfRoute(app.route);
  const cfg = app.info?.project.claude;
  const projectDir = app.info?.dir;
  const [scope, setScope] = useState<Kind>("project");
  const [ask, setAsk] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState(-1);
  const [model, setModel] = useState(cfg?.model ?? "opus");
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? "high");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [last, setLast] = useState<{ seconds: number; summary: string; ok: boolean } | null>(null);
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [ctxOn, setCtxOn] = useState<string[] | null>(null);
  // ponytail: what this run reads besides the test — the effective contexts until changed here, never persisted
  // (the test's own list is edited from its header), and a note said in full
  const [ctxPick, setCtxPick] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (cfg?.model) setModel(cfg.model);
    if (cfg?.effort) setEffort(cfg.effort);
  }, [cfg?.model, cfg?.effort]);

  const check = useCallback((refresh = false) => {
    setChecking(refresh);
    return call<ClaudeStatus>("claude.status", refresh ? { refresh: true, signIn: true } : {})
      .then(setStatus)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  const testId = focus?.testId;
  const defaults = cfg?.contexts;
  const loadContexts = useCallback(() => {
    if (!projectDir) {
      setCtxOn(null);
      return;
    }
    if (testId)
      call<{ effective: string[] }>("contexts.ofTest", { testId })
        .then((r) => setCtxOn(r?.effective ?? null))
        .catch(() => setCtxOn(null));
    else setCtxOn(defaults ?? null);
  }, [projectDir, testId, defaults]);
  useEffect(() => {
    loadContexts();
    window.addEventListener(CONTEXTS_EVENT, loadContexts);
    return () => window.removeEventListener(CONTEXTS_EVENT, loadContexts);
  }, [loadContexts]);

  useEffect(() => {
    setScope(testId ? "test" : docId ? "doc" : "project");
    setCtxPick(null);
    // ponytail: another test opened — the run card of the previous one goes (Xray Editor); answers and actions stay
    setTurns((all) => (all.some((t) => t.running) ? all : all.filter((t) => t.kind !== "run")));
  }, [testId, docId]);

  useEffect(() => {
    if (focus?.step == null && scope === "step") setScope("test");
    if (!focus && (scope === "step" || scope === "test")) setScope(docId ? "doc" : "project");
    if (!docId && scope === "doc") setScope(focus ? "test" : "project");
  }, [focus, docId, scope]);

  useEffect(() => {
    if (started === null) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [started]);

  const turnCount = turns.length;
  const lastText = turns[turnCount - 1]?.text;
  useEffect(() => {
    if (turnCount || lastText) scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [turnCount, lastText]);

  const patch = (id: number, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));

  const onEvent = (id: number) => (e: JobEvent) => {
    if (e.type !== "claude") return;
    const ev: ClaudeEvent = e.event;
    if (ev.type === "text") patch(id, (t) => ({ ...t, text: t.text + ev.text }));
    else if (ev.type === "tool")
      patch(id, (t) => ({
        ...t,
        tools: [...t.tools.map((x) => ({ ...x, done: true })), { label: toolLabel(ev.name, ev.input), done: false }],
      }));
  };

  const offline = !!status && (!status.installed || status.signedIn === false);
  const running = busy;
  const kind: Kind = scope;
  const mode: Mode = kind === "doc" || (kind === "project" && ask) ? "docs" : "test";

  const runOnTest = async (
    answerId: number,
    testId: string,
    name: string,
    args: unknown,
    t0: number,
    used: { model: string; effort: Effort },
    again?: Again,
  ) => {
    app.setClaudeRunning(testId || PROJECT_RUN);
    try {
      type Ran = RunResult & { changedSteps?: Record<string, number[]> | number[] };
      let r: Ran;
      try {
        r = await run<Ran>(name, args, onEvent(answerId), setJobId);
      } catch (e) {
        // ponytail: a cancelled run keeps what Claude already wrote — it is shown, reloaded and revertable like any run
        const left = e instanceof ApiError && e.cancelled ? (e.result as Ran | undefined) : undefined;
        if (!left?.runId) throw e;
        r = { ...left, ok: false, summary: left.summary || "Cancelled" };
      }
      const changedSteps: Record<string, number[]> = Array.isArray(r.changedSteps)
        ? r.changedSteps.length
          ? { [testId]: r.changedSteps }
          : {}
        : (r.changedSteps ?? {});
      const changedTests = r.changedTests ?? Object.keys(changedSteps);
      const steps = Object.values(changedSteps).reduce((n, s) => n + s.length, 0);
      const outcome = fixOutcome(r);
      const ok = r.ok !== false;
      const reported = typeof r.durationMs === "number";
      const durationMs = reported ? r.durationMs : Date.now() - t0;
      const sc = r.action?.scope;
      patch(answerId, (t) => ({
        ...t,
        text: t.text || r.summary,
        trouble: ok ? undefined : (r.diagnosis ?? { title: "The run did not finish", detail: r.summary }),
        note: ok && !t.action ? outcome.note : undefined,
        meta:
          again || reported
            ? { durationMs, tokens: r.tokens, sessionId: r.sessionId, model: used.model, effort: used.effort }
            : t.meta,
        raw: typeof r.raw === "string" ? r.raw : t.raw,
        again: ok ? undefined : again,
        action: r.action ?? t.action,
        // ponytail: every run with a snapshot gets its card, « 0 steps changed » too, with Revert (Xray Editor)
        run: r.runId
          ? {
              runId: r.runId,
              testId: testId || changedTests[0] || "",
              ...(sc?.kind === "doc" ? { docId: sc.docId } : {}),
              steps,
              tests: changedTests.length,
              ...(r.changedFiles ? { files: r.changedFiles.length } : {}),
              review: t.action ? undefined : r.review,
            }
          : undefined,
      }));
      setLast({ seconds: durationMs / 1000, summary: (r.summary ?? "").split("\n")[0], ok });
      app.setLastRun({
        runId: r.runId ?? "",
        changedTests,
        changedSteps,
        testId,
        review: r.review,
        message: r.message,
        nonce: Date.now(),
      });
      app.testsChanged();
      if (r.changedFiles?.length) app.refreshInfo();
      if (r.diagnosis && ["connect", "login"].includes(r.diagnosis.kind)) void check();
    } finally {
      app.setClaudeRunning(null);
    }
  };

  const start = (kind: "run" | "chat", text: string, label?: string, testId?: string) => {
    const user: Turn = { id: ++seq, role: "user", kind, text, tools: [], label, testId };
    const answer: Turn = { id: ++seq, role: "assistant", kind, text: "", tools: [], running: true, testId };
    // ponytail: a run shows its last result card only (Xray Editor's), the questions are a conversation, and the
    // action cards stay until run, put aside or dismissed
    setTurns((all) => [...(kind === "run" ? all.filter((t) => t.kind !== "run") : all), user, answer]);
    setBusy(true);
    setStarted(Date.now());
    return answer.id;
  };

  const settle = (answerId: number) => {
    patch(answerId, (t) => ({ ...t, running: false, tools: t.tools.map((x) => ({ ...x, done: true })) }));
    setBusy(false);
    setStarted(null);
    setJobId(null);
  };

  const stopped = (answerId: number, e: unknown, again?: Again) => {
    patch(answerId, (t) => ({ ...t, trouble: { title: "Claude stopped", detail: message(e) }, again }));
    setLast({ seconds: 0, summary: message(e), ok: false });
  };

  const runJob = async (job: DockJob) => {
    if (busy) {
      toast({ kind: "info", title: "Claude is busy", detail: "Wait for the current run, or cancel it (Esc)." });
      return;
    }
    const answerId = start("run", job.label, undefined, job.testId);
    try {
      await flushEditor();
      await runOnTest(answerId, job.testId, job.name, job.input, Date.now(), {
        model: cfg?.model ?? "",
        effort: cfg?.effort ?? "high",
      });
    } catch (e) {
      stopped(answerId, e);
    } finally {
      settle(answerId);
    }
  };

  // ponytail: an action comes in as its own card, ready to run with the model and effort chosen on it — never as a
  // prompt copied into the box; the same action asked twice is the same card
  const addActions = (list: ClaudeAction[]) => {
    const first = list[0];
    if (!first) return;
    if (!running) setScope(kindOf(first.scope));
    setTurns((all) => {
      const have = new Set(all.filter((t) => t.action && t.ready).map((t) => t.action?.id));
      const fresh = list.filter((a) => !have.has(a.id));
      return [
        ...all,
        ...fresh.map(
          (a): Turn => ({
            id: ++seq,
            role: "assistant",
            text: "",
            tools: [],
            action: a,
            ready: true,
            pick: { model: cfg?.model ?? "opus", effort: cfg?.effort ?? "high" },
          }),
        ),
      ];
    });
  };

  const runAction = async (t: Turn) => {
    const a = t.action;
    if (!a || !t.pick) return;
    if (busy) {
      toast({ kind: "info", title: "Claude is busy", detail: "Wait for the current run, or cancel it (Esc)." });
      return;
    }
    const used = t.pick;
    patch(t.id, (x) => ({ ...x, ready: false, running: true, text: "", tools: [], trouble: undefined }));
    setBusy(true);
    setStarted(Date.now());
    const tid = "testId" in a.scope ? a.scope.testId : "";
    try {
      await flushEditor();
      await runOnTest(
        t.id,
        tid,
        "actions.run",
        { id: a.id, model: used.model || undefined, effort: used.effort },
        Date.now(),
        used,
      );
    } catch (e) {
      stopped(t.id, e);
    } finally {
      settle(t.id);
      actionsChanged();
    }
  };

  const dropCard = (t: Turn) => setTurns((all) => all.filter((x) => x.id !== t.id));

  const dismiss = (t: Turn) => {
    if (!t.action) return;
    call("actions.dismiss", { id: t.action.id })
      .then(() => {
        dropCard(t);
        actionsChanged();
      })
      .catch((e) => errorToast(e, "Could not dismiss the action"));
  };

  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    if (request.actions) {
      addActions(request.actions);
      return;
    }
    if (request.mode === "docs") {
      setScope(docId ? "doc" : "project");
      setAsk(true);
    } else if (request.scope) {
      setScope(request.scope);
      if (request.scope === "project") setAsk(false);
    }
    if (request.job) {
      void runJob(request.job);
      return;
    }
    if (request.prompt !== undefined) {
      setPrompt(request.prompt);
      setPreset(-1);
    }
    setTimeout(() => input.current?.focus(), 0);
  });

  const execute = async (a: Again) => {
    if (running) return;
    const m = a.mode;
    const t0 = Date.now();
    const tid = a.scope && "testId" in a.scope ? a.scope.testId : undefined;
    const answerId = start(m === "test" ? "run" : "chat", a.text, a.label, m === "test" ? tid : undefined);
    try {
      if (m === "docs") {
        const r = await run<ChatResult>(
          "chat.ask",
          {
            question: a.text,
            chatId,
            model: a.model || undefined,
            effort: a.effort,
            ...(a.contexts?.length ? { contexts: a.contexts } : {}),
            ...(a.note ? { note: a.note } : {}),
          },
          onEvent(answerId),
          setJobId,
        );
        setChatId(r.chatId ?? chatId);
        const ok = r.ok !== false;
        const durationMs = Date.now() - t0;
        patch(answerId, (t) => ({
          ...t,
          text: r.answer || t.text,
          sources: r.sources ?? [],
          trouble: ok ? undefined : (r.diagnosis ?? { title: "Claude could not answer", detail: "" }),
          meta: { durationMs, tokens: r.tokens, sessionId: r.sessionId, model: a.model, effort: a.effort },
          again: ok ? undefined : a,
        }));
        setLast({ seconds: durationMs / 1000, summary: (r.answer ?? "").split("\n")[0], ok });
        if (r.diagnosis && ["connect", "login"].includes(r.diagnosis.kind)) void check();
      } else if (a.scope) {
        await flushEditor();
        const sc = a.scope;
        await runOnTest(
          answerId,
          "testId" in sc ? sc.testId : (focus?.testId ?? ""),
          "claude.run",
          {
            scope: sc,
            prompt: a.text,
            model: a.model || undefined,
            effort: a.effort,
            ...(a.contexts ? { contexts: a.contexts } : {}),
            ...(a.note ? { note: a.note } : {}),
          },
          t0,
          a,
          a,
        );
      }
    } catch (e) {
      stopped(answerId, e, a);
    } finally {
      settle(answerId);
    }
  };

  const scopeOf = (): ClaudeScope =>
    kind === "step" && focus && focus.step != null
      ? { kind: "step", testId: focus.testId, step: focus.step }
      : kind === "test" && focus
        ? { kind: "test", testId: focus.testId }
        : { kind: "project" };
  const scopeWord =
    kind === "step" && focus?.step != null
      ? `Step ${focus.step}`
      : kind === "test" && focus
        ? (focus.key ?? "This test")
        : kind === "doc" && docId
          ? docId
          : "Whole project";
  const presets = cfg?.presets ?? [];
  const here = useActions(
    !projectDir
      ? null
      : (kind === "step" || kind === "test") && testId
        ? { testId }
        : kind === "doc" && docId
          ? { docId }
          : {},
  );
  const carded = new Set(turns.filter((t) => t.action).map((t) => t.action?.id));
  const waiting = here.filter((a) => !carded.has(a.id) && a.state === "open");

  const docNote = (n: string) =>
    [docId ? `The question is about the document ${docId}: answer from docs/${docId}/doc.md first.` : "", n]
      .filter(Boolean)
      .join("\n");

  const send = (text: string) => {
    const q = text.trim();
    // ponytail: on a test or the project an empty box still runs — the scope and the house rules are the request
    // (Xray Editor); a question to the documents needs words
    if ((!q && mode === "docs") || running) return;
    const a: Again =
      mode === "docs"
        ? {
            mode,
            text: q,
            model,
            effort,
            contexts: ctxPick ?? [],
            note: (kind === "doc" ? docNote(note.trim()) : note.trim()) || undefined,
            label: kind === "doc" && docId ? docId : undefined,
          }
        : {
            mode,
            text: q,
            scope: scopeOf(),
            contexts: ctxPick ?? ctxOn ?? undefined,
            note: note.trim() || undefined,
            label: `${scopeWord}${preset >= 0 && presets[preset] ? ` · ${presets[preset].label}` : ""}`,
            model,
            effort,
          };
    // ponytail: the request stays in the box after a run on a test, ready to adjust and run again (Xray Editor)
    if (mode === "docs") {
      setPrompt("");
      setPreset(-1);
    }
    void execute(a);
  };

  const cancel = () => {
    if (!jobId) return;
    call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel the run"));
  };

  const revert = async (t: Turn, force = false) => {
    if (!t.run) return;
    try {
      await flushEditor();
      const r = (await revertRun(t.run.runId, force)) as { reverted?: string[]; files?: string[] };
      patch(t.id, (x) => ({ ...x, run: x.run && { ...x.run, reverted: true } }));
      app.setLastRun({ runId: "", changedTests: r.reverted ?? [], changedSteps: {}, nonce: Date.now() });
      app.testsChanged();
      if (r.files?.length) app.refreshInfo();
      actionsChanged();
      toast({
        kind: "info",
        title: "Claude's changes reverted",
        detail: `${plural(r.reverted?.length ?? 0, "test")}${r.files?.length ? ` and ${plural(r.files.length, "file")}` : ""} restored.`,
      });
    } catch (e) {
      if (!force && editedAfterRun(e))
        toast({
          kind: "error",
          title: "Edited after the Claude run",
          detail: message(e),
          action: { label: "Revert anyway", run: () => void revert(t, true) },
        });
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  const elapsed = started === null ? 0 : (Date.now() - started) / 1000;
  const notInstalled = !!status && !status.installed;

  if (folded)
    return (
      <aside className="dock dock-folded" aria-label="Claude">
        <button type="button" className="rail-item" aria-label="Open Claude" onClick={onFold}>
          <Icon name="claude" size={20} />
          <span>Claude</span>
          {running && (
            <span className="dock-busy" title="Claude is running">
              <span className="dot run-dot" />
              Running {elapsed.toFixed(0)} s
            </span>
          )}
        </button>
        {notInstalled && (
          <Badge tone="warn" small title="Claude is optional — everything else works without it">
            not connected
          </Badge>
        )}
        {!running && last && (
          <span className={cx("dock-last", !last.ok && "dock-last-bad")} title={last.summary}>
            Last run: {last.seconds.toFixed(1)} s{last.summary ? ` — ${last.summary}` : ""}
          </span>
        )}
        <Kbd>Ctrl J</Kbd>
        <OnTopToggle />
      </aside>
    );

  const ctxIds = ctxPick ?? (mode === "test" ? (ctxOn ?? []) : []);
  const scopeRow = (
    <fieldset className="dock-scopes plainset" aria-label="Claude scope">
      <Segmented<Kind>
        label="Scope"
        className="dock-seg"
        value={kind}
        onChange={(k) => !running && setScope(k)}
        options={[
          {
            value: "step",
            label: focus?.step != null ? `Step ${focus.step}` : "Step",
            disabled: running || focus?.step == null,
            title: focus?.step != null ? `Only step ${focus.step} of ${focus.key ?? "this test"}` : "Open a step first",
          },
          {
            value: "test",
            label: "Test",
            disabled: running || !focus,
            title: focus ? `The whole test ${focus.key ?? focus.summary}` : "Open a test first",
          },
          {
            value: "doc",
            label: "Document",
            disabled: running || !docId,
            title: docId ? `The document ${docId}` : "Open a document first",
          },
          { value: "project", label: "Project", disabled: running, title: "The whole project" },
        ]}
      />
      <span className="muted dock-scope-line">
        {kind === "project" ? (
          "Whole project"
        ) : kind === "doc" ? (
          <>
            <span className="mono dock-key">{docId}</span> · whole document
          </>
        ) : (
          <>
            <span className="mono dock-key">{focus?.key ?? "local test"}</span>
            {kind === "step" && focus?.step != null ? ` · step ${focus.step}` : " · whole test"}
          </>
        )}
      </span>
      {kind === "project" && (
        <Segmented<"ask" | "change">
          label="What Claude does on the project"
          className="dock-seg dock-seg-sub"
          value={ask ? "ask" : "change"}
          onChange={(v) => !running && setAsk(v === "ask")}
          options={[
            { value: "ask", label: "Ask the documents", disabled: running, title: "Questions; nothing is changed" },
            {
              value: "change",
              label: "Change every test",
              disabled: running,
              title: "Claude may edit every test; every change can be reverted",
            },
          ]}
        />
      )}
    </fieldset>
  );

  const body = (t: Turn) => (
    <>
      {t.tools.length > 0 && (
        <div className="tool-steps">
          {t.tools.map((x, i) => (
            <span key={i} className={cx("tool-step", !x.done && "is-running")}>
              <span className="tool-glyph" aria-hidden="true">
                {x.done ? <Icon name="check" className="tool-ok" /> : <span className="spin spin-sm" />}
              </span>
              <span className="tool-label">
                {x.label}
                {!x.done && "…"}
              </span>
            </span>
          ))}
        </div>
      )}
      {(t.text || (t.running && !t.tools.some((x) => !x.done))) && (
        <AnswerText text={t.text} running={t.running} onOpenSource={app.openSource} />
      )}
      {!!t.sources?.length && (
        <div className="turn-sources">
          {t.sources.map((s, i) => (
            <SourceChip key={i} source={s} onOpen={app.openSource} />
          ))}
        </div>
      )}
      {t.trouble && (
        <div className="trouble" role="status">
          <strong>{t.trouble.title}</strong>
          {t.trouble.detail && <p>{t.trouble.detail}</p>}
        </div>
      )}
      {t.note && (
        <div className="trouble" role="status">
          <strong>Still To fix</strong>
          <p>{t.note}</p>
        </div>
      )}
      {t.run && (
        <div className="runcard">
          <span className="runcard-title">
            {t.run.reverted
              ? "Reverted"
              : t.action
                ? `${
                    [t.run.files ? plural(t.run.files, "file") : "", t.run.steps ? plural(t.run.steps, "step") : ""]
                      .filter(Boolean)
                      .join(" and ") || "Nothing"
                  } changed`
                : `${plural(t.run.steps, "step")} changed${t.run.tests > 1 ? ` in ${t.run.tests} tests` : ""} · ${fixOutcome(t.run).word}`}
          </span>
          {!t.run.reverted && (
            <div className="runcard-actions">
              <Button
                size="sm"
                onClick={() =>
                  t.run?.docId && !t.run.steps
                    ? app.navigate("documents", t.run.docId)
                    : app.navigate("tests", t.run?.testId)
                }
              >
                Show changes
              </Button>
              <Button size="sm" icon="revert" onClick={() => void revert(t)}>
                Revert
              </Button>
            </div>
          )}
        </div>
      )}
      {t.meta && !t.running && <span className="muted mono run-meta">{metaLine(t.meta)}</span>}
      {!t.running && (t.again || t.trouble || t.raw !== undefined) && (
        <div className={cx("runcard-actions", (t.again || t.trouble) && "run-fail")}>
          {t.again && (
            <Button size="sm" icon="revert" disabled={running} onClick={() => t.again && void execute(t.again)}>
              Retry
            </Button>
          )}
          {t.action && t.trouble && (
            <Button
              size="sm"
              icon="revert"
              disabled={running}
              onClick={() => patch(t.id, (x) => ({ ...x, ready: true, trouble: undefined }))}
            >
              Try again
            </Button>
          )}
          {t.raw !== undefined && (
            <Button size="sm" tone="quiet" onClick={() => patch(t.id, (x) => ({ ...x, showRaw: !x.showRaw }))}>
              {t.showRaw ? "Hide raw output" : "Show raw output"}
            </Button>
          )}
          {(t.again || t.trouble) && (
            <Button size="sm" tone="quiet" onClick={() => app.navigate("settings", "claude")}>
              Open Settings
            </Button>
          )}
        </div>
      )}
      {t.showRaw && t.raw !== undefined && <pre className="run-raw">{t.raw || "(no output)"}</pre>}
    </>
  );

  return (
    <aside
      className="dock"
      aria-label="Claude"
      onKeyDown={(e) => {
        if (e.key === "Escape" && running) {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <div className="dock-head">
        <Icon name="claude" className="dock-logo" />
        <h2 className="h dock-title">Ask Claude</h2>
        {notInstalled && (
          <Badge tone="warn" small>
            not connected
          </Badge>
        )}
        <div className="spacer" />
        <OnTopToggle />
        <Button tone="quiet" size="sm" kbd="Ctrl J" onClick={onFold}>
          Hide
        </Button>
      </div>
      {offline && status ? (
        <ConnectClaude
          status={status}
          checking={checking}
          onCheck={() => void check(true)}
          onDoctor={() => app.navigate("doctor")}
          onSetPath={() => app.navigate("settings", "claude-exe")}
        />
      ) : (
        <>
          {scopeRow}
          <div className="dock-log" ref={scroller} aria-live="polite">
            {!turns.length && (
              <p className="muted dock-empty">
                {mode === "docs"
                  ? kind === "doc"
                    ? `Ask anything about ${docId}. Answers come with the passages they rely on.`
                    : "Ask anything about the documents. Answers come with the passages they rely on."
                  : kind === "project"
                    ? "Ask Claude to work on every test of the project. Every change can be reverted."
                    : "Ask Claude to change or explain this test. Every change can be reverted."}
              </p>
            )}
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="bubble-wrap">
                  {t.label && <span className="muted bubble-label">{t.label}</span>}
                  <div className="bubble">
                    {t.text || (
                      <span className="muted">No request — Claude works from the scope and the house rules</span>
                    )}
                  </div>
                </div>
              ) : t.action ? (
                <ActionCard
                  key={t.id}
                  action={t.action}
                  ready={!!t.ready}
                  busy={running}
                  model={t.pick?.model ?? model}
                  effort={t.pick?.effort ?? effort}
                  meta={t.meta && !t.running ? `${t.meta.model || "default"} · ${t.meta.effort}` : undefined}
                  onModel={(m) => patch(t.id, (x) => ({ ...x, pick: { model: m, effort: x.pick?.effort ?? effort } }))}
                  onEffort={(e) => patch(t.id, (x) => ({ ...x, pick: { model: x.pick?.model ?? model, effort: e } }))}
                  onRun={() => void runAction(t)}
                  onLater={() => dropCard(t)}
                  onDismiss={() => dismiss(t)}
                >
                  <div className="turn">{body(t)}</div>
                </ActionCard>
              ) : (
                <div key={t.id} className="turn">
                  {body(t)}
                </div>
              ),
            )}
            {waiting.length > 0 && (
              <div className="dock-actions">
                <span className="muted">
                  {plural(waiting.length, "Claude action")}{" "}
                  {kind === "doc" ? "on this document" : kind === "project" ? "in the project" : "on this test"}
                </span>
                {waiting.slice(0, 6).map((a: Action) => (
                  <ActionButton key={a.id} action={a} onOpen={(x) => addActions([x])} />
                ))}
              </div>
            )}
          </div>
          <div className="dock-foot">
            {mode === "test" && !!presets.length && (
              <fieldset className="presets plainset" aria-label="Quick asks">
                {presets.map((p, i) => (
                  <button
                    key={`${i}-${p.label}`}
                    type="button"
                    className={cx("chip chip-btn", preset === i && "chip-on")}
                    aria-pressed={preset === i}
                    disabled={running}
                    title={p.prompt}
                    onClick={() => {
                      setPreset(i);
                      setPrompt(p.prompt);
                      input.current?.focus();
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </fieldset>
            )}
            <AdditionalContext
              id="dock-note"
              compact
              disabled={running}
              ids={ctxIds}
              note={note}
              onIds={setCtxPick}
              onNote={setNote}
            />
            <label htmlFor="dock-ask" className="sr">
              {mode === "docs"
                ? kind === "doc"
                  ? `Ask about ${docId}`
                  : "Ask the documents"
                : kind === "project"
                  ? "Ask Claude about the project"
                  : "Ask Claude about this test"}
            </label>
            <textarea
              id="dock-ask"
              ref={input}
              className="field dock-input"
              rows={2}
              placeholder={
                mode === "docs"
                  ? kind === "doc"
                    ? `Ask anything about ${docId}…`
                    : "Ask the documents…"
                  : kind === "project"
                    ? "Tell Claude what to do with every test…"
                    : "Ask Claude to change or explain this test…"
              }
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPreset(-1);
              }}
              onKeyDown={(e) => {
                // ponytail: Enter is a new line, Ctrl+Enter sends (Xray Editor)
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send(prompt);
                }
              }}
            />
            <div className="dock-controls">
              <ModelPicker value={model} className="btn btn-sm select" onChange={setModel} />
              <select
                className="btn btn-sm select"
                aria-label="Effort"
                value={effort}
                onChange={(e) => setEffort(e.target.value as Effort)}
              >
                {EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    Effort: {x}
                  </option>
                ))}
              </select>
              <div className="spacer" />
              {running ? (
                <>
                  <span className="muted mono dock-elapsed" title="Seconds running">
                    {elapsed.toFixed(1)} s
                  </span>
                  <Button size="sm" icon="stop" kbd="Esc" disabled={!jobId} onClick={cancel}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  icon="send"
                  className={cx(!prompt.trim() && "is-idle")}
                  disabled={mode === "docs" && !prompt.trim()}
                  title="Ctrl+Enter"
                  onClick={() => send(prompt)}
                >
                  Send
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
