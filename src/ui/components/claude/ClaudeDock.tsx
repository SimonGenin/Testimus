import { useCallback, useEffect, useRef, useState } from "react";
import type {
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
import { useApp } from "../../lib/app.ts";
import { flushEditor } from "../../lib/editorBus.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Badge, Button, Chip, Icon, Kbd, SourceChip, Tabs } from "../ui/index.ts";
import { AnswerText } from "./AnswerText.tsx";
import { type ClaudeStatus, ConnectClaude } from "./ConnectClaude.tsx";
import { CONTEXTS_EVENT, type ContextSummary } from "./ContextsDialog.tsx";
import { EFFORTS, ModelPicker } from "./ModelPicker.tsx";
import { OnTopToggle } from "./OnTopToggle.tsx";

type Mode = "docs" | "test";
type Kind = "step" | "test" | "project";

type Meta = { durationMs: number; tokens?: Tokens; sessionId?: string; model: string; effort: Effort };
type Again = {
  mode: Mode;
  text: string;
  scope?: ClaudeScope;
  contexts?: string[];
  label?: string;
  model: string;
  effort: Effort;
};

type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  tools: { label: string; done: boolean }[];
  running?: boolean;
  label?: string;
  sources?: Source[];
  trouble?: Diagnosis | { title: string; detail: string };
  run?: { runId: string; testId: string; steps: number; tests: number; reverted?: boolean; review?: string };
  note?: string;
  meta?: Meta;
  raw?: string;
  showRaw?: boolean;
  again?: Again;
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
  review?: string;
  message?: string;
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

let seq = 0;

export type DockJob = { name: string; input: unknown; label: string; testId: string };
export type DockRequest = {
  mode: Mode;
  scope?: "test" | "step" | "project";
  prompt?: string;
  job?: DockJob;
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
  const cfg = app.info?.project.claude;
  const projectDir = app.info?.dir;
  const [mode, setMode] = useState<Mode>("docs");
  const [scope, setScope] = useState<Kind>("test");
  const [turns, setTurns] = useState<Record<Mode, Turn[]>>({ docs: [], test: [] });
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
  const [ctxAll, setCtxAll] = useState<ContextSummary[]>([]);
  const [ctxOn, setCtxOn] = useState<string[] | null>(null);
  // ponytail: a per-run opt-out, never persisted — the test's own list is edited from its header
  const [ctxOff, setCtxOff] = useState<Set<string>>(new Set());
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
      setCtxAll([]);
      setCtxOn(null);
      return;
    }
    call<ContextSummary[]>("contexts.list", {})
      .then((l) => setCtxAll(l ?? []))
      .catch(() => setCtxAll([]));
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
    setScope(testId ? "test" : "project");
    setCtxOff(new Set());
    // ponytail: another test opened — the result card of the previous one goes (Xray Editor)
    setTurns((all) => (all.test.some((t) => t.running) ? all : { ...all, test: [] }));
  }, [testId]);

  useEffect(() => {
    if (focus && mode === "docs" && !turns.docs.length) setMode("test");
    if (focus?.step == null && scope === "step") setScope("test");
  }, [focus, mode, scope, turns.docs.length]);

  useEffect(() => {
    if (started === null) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [started]);

  const turnCount = turns[mode].length;
  const lastText = turns[mode][turnCount - 1]?.text;
  useEffect(() => {
    if (turnCount || lastText) scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [turnCount, lastText]);

  const patch = (m: Mode, id: number, fn: (t: Turn) => Turn) =>
    setTurns((all) => ({ ...all, [m]: all[m].map((t) => (t.id === id ? fn(t) : t)) }));

  const onEvent = (m: Mode, id: number) => (e: JobEvent) => {
    if (e.type !== "claude") return;
    const ev: ClaudeEvent = e.event;
    if (ev.type === "text") patch(m, id, (t) => ({ ...t, text: t.text + ev.text }));
    else if (ev.type === "tool")
      patch(m, id, (t) => ({
        ...t,
        tools: [...t.tools.map((x) => ({ ...x, done: true })), { label: toolLabel(ev.name, ev.input), done: false }],
      }));
  };

  const offline = !!status && (!status.installed || status.signedIn === false);
  const running = busy;
  const kind: Kind = !focus ? "project" : scope;

  const runOnTest = async (
    m: Mode,
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
        r = await run<Ran>(name, args, onEvent(m, answerId), setJobId);
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
      patch(m, answerId, (t) => ({
        ...t,
        text: t.text || r.summary,
        trouble: ok ? undefined : (r.diagnosis ?? { title: "The run did not finish", detail: r.summary }),
        note: ok ? outcome.note : undefined,
        meta:
          again || reported
            ? { durationMs, tokens: r.tokens, sessionId: r.sessionId, model: used.model, effort: used.effort }
            : t.meta,
        raw: typeof r.raw === "string" ? r.raw : t.raw,
        again: ok ? undefined : again,
        // ponytail: every run with a snapshot gets its card, « 0 steps changed » too, with Revert (Xray Editor)
        run: r.runId
          ? {
              runId: r.runId,
              testId: testId || changedTests[0] || "",
              steps,
              tests: changedTests.length,
              review: r.review,
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
      if (r.diagnosis && ["connect", "login"].includes(r.diagnosis.kind)) void check();
    } finally {
      app.setClaudeRunning(null);
    }
  };

  const start = (m: Mode, text: string, label?: string) => {
    const user: Turn = { id: ++seq, role: "user", text, tools: [], label };
    const answer: Turn = { id: ++seq, role: "assistant", text: "", tools: [], running: true };
    // ponytail: on a test the dock shows the last run only (Xray Editor's result card); the documents tab is a chat
    setTurns((all) => ({ ...all, [m]: m === "test" ? [user, answer] : [...all[m], user, answer] }));
    setBusy(true);
    setStarted(Date.now());
    return answer.id;
  };

  const settle = (m: Mode, answerId: number) => {
    patch(m, answerId, (t) => ({ ...t, running: false, tools: t.tools.map((x) => ({ ...x, done: true })) }));
    setBusy(false);
    setStarted(null);
    setJobId(null);
  };

  const stopped = (m: Mode, answerId: number, e: unknown, again?: Again) => {
    patch(m, answerId, (t) => ({ ...t, trouble: { title: "Claude stopped", detail: message(e) }, again }));
    setLast({ seconds: 0, summary: message(e), ok: false });
  };

  const runJob = async (job: DockJob) => {
    if (busy) {
      toast({ kind: "info", title: "Claude is busy", detail: "Wait for the current run, or cancel it (Esc)." });
      return;
    }
    const answerId = start("test", job.label);
    try {
      await flushEditor();
      await runOnTest("test", answerId, job.testId, job.name, job.input, Date.now(), {
        model: cfg?.model ?? "",
        effort: cfg?.effort ?? "high",
      });
    } catch (e) {
      stopped("test", answerId, e);
    } finally {
      settle("test", answerId);
    }
  };

  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    setMode(request.mode);
    if (request.scope) setScope(request.scope);
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
    const answerId = start(m, a.text, a.label);
    try {
      if (m === "docs") {
        const r = await run<ChatResult>(
          "chat.ask",
          { question: a.text, chatId, model: a.model || undefined, effort: a.effort },
          onEvent(m, answerId),
          setJobId,
        );
        setChatId(r.chatId ?? chatId);
        const ok = r.ok !== false;
        const durationMs = Date.now() - t0;
        patch(m, answerId, (t) => ({
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
        const tid = "testId" in sc ? sc.testId : (focus?.testId ?? "");
        await runOnTest(
          m,
          answerId,
          tid,
          "claude.run",
          {
            scope: sc,
            prompt: a.text,
            model: a.model || undefined,
            effort: a.effort,
            ...(a.contexts ? { contexts: a.contexts } : {}),
          },
          t0,
          a,
          a,
        );
      }
    } catch (e) {
      stopped(m, answerId, e, a);
    } finally {
      settle(m, answerId);
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
        : "Whole project";
  const presets = cfg?.presets ?? [];

  const send = (text: string) => {
    const q = text.trim();
    // ponytail: on a test or the project an empty box still runs — the scope and the house rules are the request
    // (Xray Editor); a question to the documents needs words
    if ((!q && mode === "docs") || running) return;
    const a: Again =
      mode === "docs"
        ? { mode, text: q, model, effort }
        : {
            mode,
            text: q,
            scope: scopeOf(),
            contexts: ctxOn ? ctxOn.filter((id) => !ctxOff.has(id)) : undefined,
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
      const r = await revertRun(t.run.runId, force);
      patch("test", t.id, (x) => ({ ...x, run: x.run && { ...x.run, reverted: true } }));
      app.setLastRun({ runId: "", changedTests: r.reverted ?? [], changedSteps: {}, nonce: Date.now() });
      app.testsChanged();
      toast({
        kind: "info",
        title: "Claude's changes reverted",
        detail: `${plural(r.reverted?.length ?? 0, "test")} restored.`,
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

  const list = turns[mode];
  const ctxIds = ctxOn ?? [];
  const nameOf = (id: string) => ctxAll.find((c) => c.id === id)?.name ?? id;
  const scopeLink = (k: Kind, label: string) => (
    <button key={k} type="button" className="linkbtn" disabled={running} onClick={() => setScope(k)}>
      {label}
    </button>
  );
  const scopeRow = (
    <fieldset className="dock-scope plainset" aria-label="Claude scope">
      <span className="label">Scope</span>
      <Chip small>
        {kind === "project" || !focus ? (
          "Whole project"
        ) : (
          <>
            <span className="mono dock-key">{focus.key ?? "local test"}</span>
            {kind === "step" && focus.step != null ? ` · step ${focus.step}` : " · whole test"}
          </>
        )}
      </Chip>
      {focus && focus.step != null && kind !== "step" && scopeLink("step", `Only step ${focus.step}`)}
      {focus && kind !== "test" && scopeLink("test", "Whole test")}
      {kind !== "project" && scopeLink("project", "Whole project")}
    </fieldset>
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
        <Icon name="claude" />
        <h2 className="h dock-title">Claude</h2>
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
      <Tabs
        label="Claude mode"
        className="dock-tabs"
        value={mode}
        onChange={setMode}
        options={[
          { value: "docs", label: "Ask the documents" },
          { value: "test", label: focus ? "On this test" : "On the project" },
        ]}
      />
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
          {mode === "test" && scopeRow}
          <div className="dock-log" ref={scroller} aria-live="polite">
            {!list.length && (
              <p className="muted dock-empty">
                {mode === "docs"
                  ? "Ask anything about the documents. Answers come with the passages they rely on."
                  : focus
                    ? "Ask Claude to change or explain this test. Every change can be reverted."
                    : "Ask Claude to work on every test of the project. Every change can be reverted."}
              </p>
            )}
            {list.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="bubble-wrap">
                  {t.label && <span className="muted bubble-label">{t.label}</span>}
                  <div className="bubble">
                    {t.text || (
                      <span className="muted">No request — Claude works from the scope and the house rules</span>
                    )}
                  </div>
                </div>
              ) : (
                <div key={t.id} className="turn">
                  {t.tools.length > 0 && (
                    <div className="acts">
                      {t.tools.map((x, i) => (
                        <span key={i} className="act">
                          {x.done ? <Icon name="check" className="act-ok" /> : <span className="dot act-dot" />}
                          {x.label}
                          {!x.done && "…"}
                        </span>
                      ))}
                    </div>
                  )}
                  {(t.text || t.running) && (
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
                          : `${plural(t.run.steps, "step")} changed${t.run.tests > 1 ? ` in ${t.run.tests} tests` : ""} · ${fixOutcome(t.run).word}`}
                      </span>
                      {!t.run.reverted && (
                        <div className="runcard-actions">
                          <Button size="sm" onClick={() => app.navigate("tests", t.run?.testId)}>
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
                        <Button
                          size="sm"
                          icon="revert"
                          disabled={running}
                          onClick={() => t.again && void execute(t.again)}
                        >
                          Retry
                        </Button>
                      )}
                      {t.raw !== undefined && (
                        <Button
                          size="sm"
                          tone="quiet"
                          onClick={() => patch(mode, t.id, (x) => ({ ...x, showRaw: !x.showRaw }))}
                        >
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
                </div>
              ),
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
            {mode === "test" && ctxIds.length > 0 && (
              <fieldset className="presets dock-ctx plainset" aria-label="Contexts for this run">
                <span className="muted dock-ctx-label">Context:</span>
                {ctxIds.map((id) => {
                  const on = !ctxOff.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={cx("chip chip-btn chip-sm", on ? "chip-on" : "chip-off")}
                      aria-pressed={on}
                      title={on ? "Included in this run — click to skip" : "Skipped for this run — click to include"}
                      onClick={() =>
                        setCtxOff((s) => {
                          const n = new Set(s);
                          if (n.has(id)) n.delete(id);
                          else n.add(id);
                          return n;
                        })
                      }
                    >
                      {nameOf(id)}
                    </button>
                  );
                })}
              </fieldset>
            )}
            <label htmlFor="dock-ask" className="sr">
              {mode === "docs"
                ? "Ask the documents"
                : focus
                  ? "Ask Claude about this test"
                  : "Ask Claude about the project"}
            </label>
            <textarea
              id="dock-ask"
              ref={input}
              className="field dock-input"
              rows={2}
              placeholder={
                mode === "docs"
                  ? "Ask the documents…"
                  : focus
                    ? "Ask Claude to change or explain this test…"
                    : "Tell Claude what to do with every test…"
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
