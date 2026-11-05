import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ClaudeAction, ClaudeEvent, Effort, JobEvent } from "../../../core/types.ts";
import type { AppState } from "../../lib/app.ts";
import { ApiError } from "../../lib/data/client.ts";
import { invalidate, type Prefix, useCommand } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { editedAfterRun, revertDone } from "../../lib/revert.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { sourcesOf } from "./AnswerText.tsx";
import {
  type Again,
  type ChatResult,
  changedOf,
  fixOutcome,
  PROJECT_RUN,
  type RunResult,
  type Turn,
  toolLabel,
  transcript,
} from "./turns.ts";
import { useClaudeJob } from "./useClaudeJob.ts";
import { noteRun } from "./useClaudeStatus.ts";

// a run handed by the app (Fix with Claude in Review, Ask Claude on a step): `text` is the request as asked, when it
// is not the label
export type DockJob = { name: string; input: unknown; label: string; testId: string; text?: string };
export type Last = { seconds: number; summary: string; ok: boolean };

const TESTS: Prefix[] = [["tests.show"]];
const BUSY = {
  tone: "neutral" as const,
  title: "Claude is busy",
  detail: "Wait for the current run to finish, or cancel it in the Claude panel.",
};
let seq = 0;

// ponytail: what the dock shows until Clear — runs, answers and action cards alike — and the one run in the air;
// the next request carries the conversation so far
export function useDockRuns(app: AppState) {
  const client = useQueryClient();
  const job = useClaudeJob();
  const cancelJob = useCommand("jobs.cancel", { invalidates: "none" });
  const revertRun = useCommand("claude.revert", { flushFirst: TESTS });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<{ turn: Turn; detail: string } | null>(null);
  const cfg = app.info?.project.claude;
  // ponytail: a Claude job started anywhere (the dock, Generate, the CLI) keeps the dock from starting another
  const locked = busy || !!app.claudeRunning;

  // ponytail: a run reverted from the editor or Review is reverted here too — its card says so, and so does the next
  // request to Claude
  const reverted = app.lastRun?.reverted;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a revert is taken once, by its nonce
  useEffect(() => {
    if (!reverted) return;
    setTurns((all) =>
      all.map((t) => (t.run?.runId === reverted && !t.run.reverted ? { ...t, run: { ...t.run, reverted: true } } : t)),
    );
    setRefused((r) => (r?.turn.run?.runId === reverted ? null : r));
  }, [app.lastRun?.nonce]);

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

  const recheck = (ok: boolean, diagnosis: { kind: string } | undefined, said: string) => {
    noteRun(client, { ok, diagnosis, said });
    if (diagnosis && ["connect", "login"].includes(diagnosis.kind)) void invalidate(client, [["claude.status"]]);
  };

  const runOnTest = async (
    answerId: number,
    testId: string,
    name: "claude.run" | "actions.run" | "review.fix",
    args: unknown,
    t0: number,
    used: { model: string; effort: Effort },
    again?: Again,
  ) => {
    // ponytail: the lock is the running job's (App); until its id comes back the dock says what it asked for
    const on = testId || PROJECT_RUN;
    app.setClaudeRunning(on);
    try {
      let r: RunResult;
      try {
        r = await job.start<RunResult>(name, args, onEvent(answerId), TESTS, (id) => app.setClaudeRunning(on, id));
      } catch (e) {
        const left = e instanceof ApiError && e.cancelled ? (e.result as RunResult | undefined) : undefined;
        if (!left?.runId) throw e;
        r = { ...left, ok: false, summary: left.summary || "Cancelled" };
      }
      const changedSteps = changedOf(r, testId);
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
        // ponytail: every run with a snapshot gets its card, « 0 steps changed » too, with Revert (Xray Editor) — but
        // a failed run that changed nothing has nothing to show, revert or check
        run:
          r.runId && (ok || steps > 0 || changedTests.length > 0 || !!r.changedFiles?.length)
            ? {
                runId: r.runId,
                testId: testId || changedTests[0] || "",
                ...(sc?.kind === "doc" ? { docId: sc.docId } : {}),
                steps,
                tests: changedTests.length,
                ...(r.changedFiles ? { files: r.changedFiles.length } : {}),
                review: t.action ? undefined : r.review,
                ...(!t.action && r.message ? { message: r.message } : {}),
                ...(name === "review.fix" ? { fix: true } : {}),
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
      recheck(ok, r.diagnosis, r.summary ?? "");
    } finally {
      app.setClaudeRunning(null);
    }
  };

  const begin = (turn: Omit<Turn, "id">, user?: Omit<Turn, "id">) => {
    const answer: Turn = { ...turn, id: ++seq };
    setTurns((all) => [...all, ...(user ? [{ ...user, id: ++seq }] : []), answer]);
    setBusy(true);
    setStarted(Date.now());
    return answer.id;
  };

  const settle = (answerId: number) => {
    patch(answerId, (t) => ({ ...t, running: false, tools: t.tools.map((x) => ({ ...x, done: true })) }));
    setBusy(false);
    setStarted(null);
  };

  const stopped = (answerId: number, e: unknown, again?: Again) => {
    patch(answerId, (t) => ({ ...t, trouble: { title: "Claude stopped", detail: message(e) }, again }));
    setLast({ seconds: 0, summary: message(e), ok: false });
  };

  const start = (kind: "run" | "chat", text: string, label?: string, testId?: string) =>
    begin(
      { role: "assistant", kind, text: "", tools: [], running: true, testId },
      { role: "user", kind, text, tools: [], label, testId },
    );

  const runJob = async (j: DockJob) => {
    if (locked) {
      toast(BUSY);
      return;
    }
    const answerId = start("run", j.text ?? j.label, j.text === undefined ? undefined : j.label, j.testId);
    try {
      const asked = (j.input ?? {}) as { model?: string; effort?: Effort };
      await runOnTest(answerId, j.testId, j.name as "review.fix", j.input, Date.now(), {
        model: asked.model ?? cfg?.model ?? "",
        effort: asked.effort ?? cfg?.effort ?? "high",
      });
    } catch (e) {
      stopped(answerId, e);
    } finally {
      settle(answerId);
    }
  };

  // ponytail: an action runs from its card in the Actions tab with the model and effort chosen on it — the run is
  // shown there under the cards, never in the other tabs
  const runAction = async (a: ClaudeAction, used: { model: string; effort: Effort }) => {
    if (locked) {
      toast(BUSY);
      return;
    }
    const conversation = transcript(turns.filter((x) => !x.action));
    const id = begin({ role: "assistant", text: "", tools: [], running: true, action: a });
    const tid = "testId" in a.scope ? a.scope.testId : "";
    try {
      await runOnTest(
        id,
        tid,
        "actions.run",
        { id: a.id, model: used.model || undefined, effort: used.effort, ...(conversation ? { conversation } : {}) },
        Date.now(),
        used,
      );
    } catch (e) {
      stopped(id, e);
    } finally {
      settle(id);
    }
  };

  const execute = async (a: Again) => {
    if (locked) return;
    const t0 = Date.now();
    const tid = a.scope && "testId" in a.scope ? a.scope.testId : undefined;
    const conversation = transcript(turns, a.mode === "docs" && !!chatId && !a.problem);
    const answerId = start(a.mode === "test" ? "run" : "chat", a.text, a.label, a.mode === "test" ? tid : undefined);
    const extra = {
      ...(a.note ? { note: a.note } : {}),
      ...(conversation ? { conversation } : {}),
    };
    try {
      if (a.mode === "docs") {
        const r = await job.start<ChatResult>(
          "chat.ask",
          {
            question: a.text,
            ...(a.problem ? { problem: a.problem } : { chatId }),
            model: a.model || undefined,
            effort: a.effort,
            ...(a.contexts?.length ? { contexts: a.contexts } : {}),
            ...extra,
          },
          onEvent(answerId),
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
          raw: typeof r.raw === "string" ? r.raw : t.raw,
          again: ok ? undefined : a,
        }));
        setLast({ seconds: durationMs / 1000, summary: (r.answer ?? "").split("\n")[0], ok });
        recheck(ok, r.diagnosis, r.raw || r.answer || "");
      } else if (a.scope) {
        await runOnTest(
          answerId,
          tid ?? app.focus?.testId ?? "",
          "claude.run",
          {
            scope: a.scope,
            prompt: a.text,
            model: a.model || undefined,
            effort: a.effort,
            ...(a.contexts ? { contexts: a.contexts } : {}),
            ...extra,
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

  const clear = () => {
    setTurns([]);
    setChatId(undefined);
    setLast(null);
  };

  // ponytail: an earlier conversation with the documents comes back as it was said, and the next question continues it
  const resume = (chat: { id: string; turns: { role: "user" | "assistant"; text: string }[] }) => {
    if (busy) return;
    setTurns(
      chat.turns.map((x) => ({
        id: ++seq,
        role: x.role,
        kind: "chat" as const,
        text: x.text,
        tools: [],
        ...(x.role === "assistant" ? { sources: sourcesOf(x.text) } : {}),
      })),
    );
    setChatId(chat.id);
    setLast(null);
  };

  const cancel = () => {
    if (job.jobId) cancelJob.mutate({ id: job.jobId }, { onError: (e) => errorToast(e, "Could not cancel the job") });
  };

  const revert = async (t: Turn, force = false) => {
    if (!t.run) return;
    setRefused(null);
    try {
      const r = (await revertRun.mutateAsync(force ? { runId: t.run.runId, force: true } : { runId: t.run.runId })) as {
        reverted?: string[];
        files?: string[];
      };
      patch(t.id, (x) => ({ ...x, run: x.run && { ...x.run, reverted: true } }));
      revertDone(app, t.run.runId, { reverted: r.reverted ?? [], files: r.files });
    } catch (e) {
      if (!force && editedAfterRun(e)) setRefused({ turn: t, detail: message(e) });
      else errorToast(e, "Could not revert Claude's changes");
    }
  };

  const toggleRaw = (t: Turn) => patch(t.id, (x) => ({ ...x, showRaw: !x.showRaw }));

  return {
    turns,
    busy,
    locked,
    started,
    last,
    jobId: job.jobId,
    refused,
    keepAsIs: () => setRefused(null),
    execute,
    runJob,
    runAction,
    clear,
    resume,
    cancel,
    revert,
    toggleRaw,
  };
}
