import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeEvent,
  ClaudeResult,
  ClaudeScope,
  Diagnosis,
  Effort,
  JobEvent,
  Source,
} from "../../../core/types.ts";
import { call, run } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { flushEditor } from "../../lib/editorBus.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { editedAfterRun, revertRun } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Button, Chip, Icon, Kbd, SourceChip, Tabs } from "../ui/index.ts";
import { AnswerText } from "./AnswerText.tsx";
import { type ClaudeStatus, ConnectClaude } from "./ConnectClaude.tsx";

type Mode = "docs" | "test";

type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  tools: { label: string; done: boolean }[];
  running?: boolean;
  sources?: Source[];
  trouble?: Diagnosis | { title: string; detail: string };
  run?: { runId: string; testId: string; steps: number; tests: number; reverted?: boolean; review?: string };
  note?: string;
};

// ponytail: review.fix re-checks in the same job — it says whether the test went back to checked, and why not
export function fixOutcome(r: { review?: string; message?: string }): { word: string; note?: string } {
  if (!r.review) return { word: "check queued" };
  if (r.review === "checked") return { word: "checked again" };
  return { word: "still To fix", note: r.message || "The test did not go back to Checked." };
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
};

const MODELS = ["opus", "sonnet", "haiku"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

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
export type DockRequest = { mode: Mode; scope?: "test" | "step"; prompt?: string; job?: DockJob; nonce: number };

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
  const [mode, setMode] = useState<Mode>("docs");
  const [scope, setScope] = useState<"test" | "step">("test");
  const [turns, setTurns] = useState<Record<Mode, Turn[]>>({ docs: [], test: [] });
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(cfg?.model ?? "sonnet");
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? "medium");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);
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

  useEffect(() => {
    if (focus && mode === "docs" && !turns.docs.length) setMode("test");
    if (!focus && mode === "test") setMode("docs");
    if (focus?.step == null && scope === "step") setScope("test");
  }, [focus, mode, scope, turns.docs.length]);

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

  const runOnTest = async (m: Mode, answerId: number, testId: string, name: string, args: unknown) => {
    app.setClaudeRunning(testId);
    try {
      const r = await run<RunResult & { changedSteps?: Record<string, number[]> | number[] }>(
        name,
        args,
        onEvent(m, answerId),
        setJobId,
      );
      const changedSteps: Record<string, number[]> = Array.isArray(r.changedSteps)
        ? r.changedSteps.length
          ? { [testId]: r.changedSteps }
          : {}
        : (r.changedSteps ?? {});
      const changedTests = r.changedTests ?? Object.keys(changedSteps);
      const steps = Object.values(changedSteps).reduce((n, s) => n + s.length, 0);
      const outcome = fixOutcome(r);
      patch(m, answerId, (t) => ({
        ...t,
        text: t.text || r.summary,
        trouble: r.ok ? undefined : (r.diagnosis ?? { title: "The run did not finish", detail: r.summary }),
        note: r.ok ? outcome.note : undefined,
        run:
          r.runId && (changedTests.length || steps)
            ? { runId: r.runId, testId, steps, tests: changedTests.length, review: r.review }
            : undefined,
      }));
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

  const start = (m: Mode, text: string) => {
    const user: Turn = { id: ++seq, role: "user", text, tools: [] };
    const answer: Turn = { id: ++seq, role: "assistant", text: "", tools: [], running: true };
    setTurns((all) => ({ ...all, [m]: [...all[m], user, answer] }));
    setBusy(true);
    return answer.id;
  };

  const settle = (m: Mode, answerId: number) => {
    patch(m, answerId, (t) => ({ ...t, running: false, tools: t.tools.map((x) => ({ ...x, done: true })) }));
    setBusy(false);
    setJobId(null);
  };

  const runJob = async (job: DockJob) => {
    if (busy) {
      toast({ kind: "info", title: "Claude is busy", detail: "Wait for the current run, or cancel it (Esc)." });
      return;
    }
    const answerId = start("test", job.label);
    try {
      await flushEditor();
      await runOnTest("test", answerId, job.testId, job.name, job.input);
    } catch (e) {
      patch("test", answerId, (t) => ({ ...t, trouble: { title: "Claude stopped", detail: message(e) } }));
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
    if (request.prompt !== undefined) setPrompt(request.prompt);
    setTimeout(() => input.current?.focus(), 0);
  });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || running) return;
    if (mode === "test" && !focus) return;
    const m = mode;
    const answerId = start(m, q);
    const answer = { id: answerId };
    setPrompt("");
    try {
      if (m === "docs") {
        const r = await run<ChatResult>(
          "chat.ask",
          { question: q, chatId, model, effort },
          onEvent(m, answer.id),
          setJobId,
        );
        setChatId(r.chatId ?? chatId);
        patch(m, answer.id, (t) => ({
          ...t,
          text: r.answer || t.text,
          sources: r.sources ?? [],
          trouble: r.ok === false ? (r.diagnosis ?? { title: "Claude could not answer", detail: "" }) : undefined,
        }));
        if (r.diagnosis && ["connect", "login"].includes(r.diagnosis.kind)) void check();
      } else if (focus) {
        await flushEditor();
        const testId = focus.testId;
        const sc: ClaudeScope =
          scope === "step" && focus.step != null
            ? { kind: "step", testId, step: focus.step }
            : { kind: "test", testId };
        await runOnTest(m, answer.id, testId, "claude.run", { scope: sc, prompt: q, model, effort });
      }
    } catch (e) {
      patch(m, answer.id, (t) => ({ ...t, trouble: { title: "Claude stopped", detail: message(e) } }));
    } finally {
      settle(m, answer.id);
    }
  };

  const cancel = () => {
    if (!jobId) return;
    call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel the run"));
  };

  const revert = async (t: Turn, force = false) => {
    if (!t.run) return;
    try {
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

  if (folded)
    return (
      <aside className="dock dock-folded" aria-label="Claude">
        <button type="button" className="rail-item" aria-label="Open Claude" onClick={onFold}>
          <Icon name="claude" size={20} />
          <span>Claude</span>
          {running && (
            <span className="dock-busy" title="Claude is running">
              <span className="dot run-dot" />
              Running
            </span>
          )}
        </button>
        <Kbd>Ctrl J</Kbd>
      </aside>
    );

  const list = turns[mode];
  const scopeChip = focus && (
    <div className="dock-scope">
      <span className="label">Scope</span>
      <Chip small>
        <span className="mono dock-key">{focus.key ?? "local test"}</span>
        {scope === "step" && focus.step != null ? ` · step ${focus.step}` : " · whole test"}
      </Chip>
      {focus.step != null && (
        <button type="button" className="linkbtn" onClick={() => setScope(scope === "step" ? "test" : "step")}>
          {scope === "step" ? "Whole test" : `Only step ${focus.step}`}
        </button>
      )}
    </div>
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
        <div className="spacer" />
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
          { value: "test", label: "On this test", disabled: !focus, title: focus ? undefined : "Open a test first" },
        ]}
      />
      {offline && status ? (
        <ConnectClaude
          status={status}
          checking={checking}
          onCheck={() => void check(true)}
          onDoctor={() => app.navigate("doctor")}
        />
      ) : (
        <>
          {mode === "test" && scopeChip}
          <div className="dock-log" ref={scroller} aria-live="polite">
            {!list.length && (
              <p className="muted dock-empty">
                {mode === "docs"
                  ? "Ask anything about the documents. Answers come with the passages they rely on."
                  : "Ask Claude to change or explain this test. Every change can be reverted."}
              </p>
            )}
            {list.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="bubble">
                  {t.text}
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
                </div>
              ),
            )}
          </div>
          <div className="dock-foot">
            {mode === "test" && !!cfg?.presets.length && (
              <div className="presets">
                {cfg.presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="chip chip-btn"
                    disabled={running || !focus}
                    title={p.prompt}
                    onClick={() => void send(p.prompt)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="dock-ask" className="sr">
              {mode === "docs" ? "Ask the documents" : "Ask Claude about this test"}
            </label>
            <textarea
              id="dock-ask"
              ref={input}
              className="field dock-input"
              rows={2}
              placeholder={mode === "docs" ? "Ask the documents…" : "Ask Claude to change or explain this test…"}
              value={prompt}
              disabled={mode === "test" && !focus}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault();
                  void send(prompt);
                }
              }}
            />
            <div className="dock-controls">
              <select
                className="btn btn-sm select"
                aria-label="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {(MODELS.includes(model) ? MODELS : [model, ...MODELS]).map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
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
                <Button size="sm" icon="stop" kbd="Esc" disabled={!jobId} onClick={cancel}>
                  Cancel
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon="send"
                  className={cx(!prompt.trim() && "is-idle")}
                  disabled={!prompt.trim() || (mode === "test" && !focus)}
                  onClick={() => void send(prompt)}
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
