import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ActionTarget, ChatProblem, Effort } from "../../../core/types.ts";
import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { key, read, useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { DockActions, useActionChoices } from "./DockActions.tsx";
import { DockComposer } from "./DockComposer.tsx";
import { DockLog } from "./DockLog.tsx";
import { DockScope } from "./DockScope.tsx";
import { useDockPlan } from "./dockPlan.ts";
import { setDockState } from "./dockState.ts";
import { type Again, docOfRoute } from "./turns.ts";
import { useClaudeStatus } from "./useClaudeStatus.ts";
import { type DockJob, useDockRuns } from "./useDockRuns.ts";
import { useDockScope } from "./useDockScope.ts";
import { useNow } from "./useNow.ts";
import { useRunContext } from "./useRunContext.tsx";

export { docOfRoute, fixOutcome, metaLine, PROJECT_RUN, toolLabel, transcript } from "./turns.ts";
export type { DockJob } from "./useDockRuns.ts";

export type DockRequest = {
  mode: "docs" | "test";
  scope?: "test" | "step" | "run" | "project";
  prompt?: string;
  /** the prompt is asked at once (the palette's « Ask Claude »), not only put in the box */
  send?: boolean;
  job?: DockJob;
  /** a problem the app met (« Ask Claude about this »): asked at once, in a conversation of its own */
  problem?: ChatProblem;
  /** how the problem's turn is named in the dock */
  label?: string;
  nonce: number;
};

export const PROBLEM_QUESTION = "What causes this, and what can I do?";

const styles = stylex.create({
  dock: {
    flex: 1,
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.surface,
  },
  foot: {
    boxSizing: "border-box",
    flex: "none",
    paddingTop: space.s3,
    paddingInline: space.s4,
    paddingBottom: space.s4,
  },
});

// ponytail: Claude in every screen — asks the documents, changes a test, a step or the whole project, runs the
// actions Claude proposed. It is the body of each screen's Claude tab (the tab says « Claude », folds it, and shows
// with a dot what the dock tells it: a run under way, the last one failed, no Claude to talk to)
export function ClaudeDock({ request }: { request?: DockRequest | null }) {
  const app = useApp();
  const client = useQueryClient();
  const focus = app.focus;
  const docId = docOfRoute(app.route);
  const cfg = app.info?.project.claude;
  const projectDir = app.info?.dir;
  const runs = useDockRuns(app);
  const busy = runs.locked;
  const where = useDockScope(focus, docId);
  const { tab, sub } = where;
  const [model, setModel] = useState(cfg?.model ?? "opus");
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? "high");
  const [checking, setChecking] = useState(false);
  const choices = useActionChoices({ model: cfg?.model ?? "opus", effort: cfg?.effort ?? "high" });
  const now = useNow(runs.started !== null);
  const [prompt, setPrompt] = useDraft([project(), "dock.prompt"]);
  const [focusAsk, setFocusAsk] = useState(0);
  const plan = useDockPlan();

  const { status } = useClaudeStatus();
  const offline = !!status && (!status.installed || status.signedIn === false);

  // ponytail: what goes with the dock's next run — a question to the documents is the chat prompt, a request on a
  // test, a step, a test run or the project is claude.run's for that scope; what the user ticked holds until the dock
  // is about something else (another tab, another scope, another test or document)
  const docsMode = tab === "docs";
  const ctx = useRunContext({
    use: docsMode ? "chat" : `ask-${where.scope.kind}`,
    scope: docsMode ? undefined : where.scope,
    note: prompt,
    conversation: runs.conversation(docsMode),
    subject: [tab, sub, focus?.run ? "" : (focus?.testId ?? ""), docId ?? ""].join("|"),
    onSaved: () => setPrompt(""),
    enabled: !!projectDir && tab !== "actions",
  });

  const view: ActionTarget | undefined =
    focus && !focus.run ? { kind: "test", id: focus.testId } : docId ? { kind: "document", id: docId } : undefined;
  const actionsRead = useRead("actions.list", view ? { view } : {}, { enabled: !!projectDir });
  const inRun = new Set(runs.turns.filter((t) => t.action && t.running).map((t) => t.action?.id));
  const actions = ((actionsRead.data as unknown as Action[] | undefined) ?? []).filter(
    (a) => a.state === "open" && !inRun.has(a.id),
  );

  useEffect(() => {
    if (cfg?.model) setModel(cfg.model);
    if (cfg?.effort) setEffort(cfg.effort);
  }, [cfg?.model, cfg?.effort]);

  // a question to the documents — about the open one when it is the scope
  const docsAgain = (q: string, onDoc: boolean): Again => ({
    mode: "docs",
    text: q,
    model,
    effort,
    ...ctx.run,
    note: onDoc ? `The question is about the document ${docId}: answer from docs/${docId}/doc.md first.` : undefined,
    label: onDoc && docId ? docId : undefined,
    ...(plan && onGenerate ? { generation: plan } : {}),
  });

  // ponytail: a plan shown on Generate is talked about with the documents — the chat has it and may propose another
  const onGenerate = app.route.screen === "generate";
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per plan shown, not on each draw of the scope
  useEffect(() => {
    if (plan && onGenerate) where.pickTab("docs");
  }, [plan, onGenerate]);

  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    // ponytail: a problem is about the project, not the documents — it is asked under « On the project », and the next
    // request there is a project run that carries the diagnosis in its conversation
    if (request.problem) where.ask("test", "project");
    else where.ask(request.mode, request.scope);
    if (request.job) {
      void runs.runJob(request.job);
      return;
    }
    if (request.problem) {
      const text = `${request.problem.text}\n\n${PROBLEM_QUESTION}`;
      if (busy || offline) setPrompt(text);
      else
        void runs.execute({
          mode: "docs",
          text,
          model,
          effort,
          ...ctx.run,
          problem: request.problem,
          label: request.label,
        });
      return;
    }
    const q = request.prompt?.trim();
    if (request.send && q && !busy && !offline) {
      void runs.execute(docsAgain(q, !!docId));
      return;
    }
    if (request.prompt !== undefined) setPrompt(request.prompt);
    setFocusAsk((n) => n + 1);
  });

  const check = async () => {
    setChecking(true);
    try {
      const r = await read(client, "claude.status", { refresh: true, signIn: true });
      client.setQueryData(key("claude.status", {}), r);
    } catch {
    } finally {
      setChecking(false);
    }
  };

  const send = (text: string, quickAsk?: string) => {
    const q = text.trim();
    // ponytail: on a test or the project an empty box still runs — the scope and the house rules are the request
    // (Xray Editor); a question to the documents needs words
    if ((!q && docsMode) || busy) return;
    const a: Again = docsMode
      ? docsAgain(q, sub === "doc" && !!docId)
      : {
          mode: "test",
          text: q,
          scope: where.scope,
          ...ctx.run,
          label: `${where.word}${quickAsk ? ` · ${quickAsk}` : ""}`,
          model,
          effort,
        };
    void runs.execute(a);
  };

  const elapsed = runs.started === null ? 0 : (now - runs.started) / 1000;
  const lastFailed = runs.last?.ok === false;
  useEffect(() => {
    setDockState({ running: runs.busy, failed: lastFailed, offline });
  }, [runs.busy, lastFailed, offline]);

  return (
    <aside
      aria-label="Claude"
      onKeyDown={(e) => {
        if (e.key === "Escape" && runs.busy) {
          e.preventDefault();
          runs.cancel();
        }
      }}
      {...stylex.props(styles.dock)}
    >
      <DockScope
        tab={tab}
        sub={sub}
        docId={docId}
        focus={focus}
        actions={actions.length}
        running={runs.busy}
        onTab={where.pickTab}
        onSub={where.setSub}
      />
      <DockLog
        runs={runs}
        tab={tab}
        docId={docId}
        offline={offline && !!status}
        status={status}
        checking={checking}
        onCheck={() => void check()}
        actionsList={
          <DockActions
            actions={actions}
            view={view}
            busy={busy}
            choices={choices}
            contexts={cfg?.contexts}
            onRun={(a, p) => void runs.runAction(a, p)}
          />
        }
        sub={sub}
      />
      {tab !== "actions" && (
        <div {...stylex.props(styles.foot)}>
          <DockComposer
            mode={docsMode ? "docs" : "test"}
            label={where.label}
            placeholder={offline ? "Claude is optional — everything else works without it" : where.placeholder}
            scope={sub === "test" && focus && !focus.run ? "Whole test" : where.word}
            quickAsks={cfg?.presets ?? []}
            context={ctx.context}
            model={model}
            effort={effort}
            running={runs.busy ? elapsed : null}
            unavailable={
              offline
                ? status?.installed
                  ? "Claude is not signed in"
                  : "Claude is not connected"
                : busy && !runs.busy
                  ? "Claude is working on another run — wait for it to finish"
                  : undefined
            }
            onModel={setModel}
            onEffort={setEffort}
            onCancel={runs.jobId ? runs.cancel : undefined}
            onSend={send}
            keepAfterSend={!docsMode}
            focusKey={focusAsk}
          />
        </div>
      )}
      {ctx.dialog}
    </aside>
  );
}
