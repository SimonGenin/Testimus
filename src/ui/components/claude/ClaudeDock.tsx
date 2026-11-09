import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ActionTarget, ChatProblem, Effort } from "../../../core/types.ts";
import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { key, read, useRead } from "../../lib/data/query.ts";
import { border, breakpoint, color, radius, shadow, size, space, z } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";
import { DockActions, useActionChoices } from "./DockActions.tsx";
import { DockComposer, runIds } from "./DockComposer.tsx";
import { DockFolded } from "./DockFolded.tsx";
import { DockLog } from "./DockLog.tsx";
import { DockScope } from "./DockScope.tsx";
import { type Again, docOfRoute } from "./turns.ts";
import { useClaudeStatus } from "./useClaudeStatus.ts";
import { type DockJob, useDockRuns } from "./useDockRuns.ts";
import { useDockScope } from "./useDockScope.ts";
import { useNow } from "./useNow.ts";
import { useRunContexts } from "./useRunContexts.ts";

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
    flex: "none",
    boxSizing: "border-box",
    width: `var(--dock-size, ${size.dock})`,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderInlineStartStyle: { default: "none", [breakpoint.narrow]: "solid" },
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
    backgroundColor: color.surface,
    position: { default: "relative", [breakpoint.narrow]: "fixed" },
    insetBlock: { default: null, [breakpoint.narrow]: 0 },
    insetInlineEnd: { default: null, [breakpoint.narrow]: 0 },
    zIndex: { default: null, [breakpoint.narrow]: z.dock },
    maxWidth: { default: null, [breakpoint.narrow]: `calc(100vw - ${size.rail})` },
    boxShadow: { default: null, [breakpoint.narrow]: shadow.s3 },
    borderRadius: { default: null, [breakpoint.narrow]: radius.r4 },
  },
  head: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: size.topbar,
    paddingInlineStart: space.s5,
    paddingInlineEnd: space.s3,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  title: { display: "inline-flex", alignItems: "center", gap: space.s2, margin: 0, color: color.claudeText },
  grow: { flex: 1 },
  foot: {
    boxSizing: "border-box",
    flex: "none",
    paddingTop: space.s3,
    paddingInline: space.s4,
    paddingBottom: space.s4,
  },
});

// ponytail: Claude beside every screen — asks the documents, changes a test, a step or the whole project, runs the
// actions Claude proposed; folded to a strip (Ctrl J)
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
  const [, setPrompt] = useDraft([project(), "dock.prompt"]);
  const [focusAsk, setFocusAsk] = useState(0);

  const { status } = useClaudeStatus();
  const offline = !!status && (!status.installed || status.signedIn === false);

  const ctx = useRunContexts({ tab, sub, focus, docId, projectDir, defaults: cfg?.contexts });

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
    contexts: runIds(ctx),
    note: onDoc ? `The question is about the document ${docId}: answer from docs/${docId}/doc.md first.` : undefined,
    label: onDoc && docId ? docId : undefined,
  });

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
          contexts: runIds(ctx),
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

  const docsMode = tab === "docs";

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
          contexts: ctx.known || Object.keys(ctx.pick).length ? runIds(ctx) : undefined,
          label: `${where.word}${quickAsk ? ` · ${quickAsk}` : ""}`,
          model,
          effort,
        };
    void runs.execute(a);
  };

  const elapsed = runs.started === null ? 0 : (now - runs.started) / 1000;

  if (folded)
    return (
      <DockFolded
        onOpen={onFold}
        actions={actions.length}
        running={runs.busy}
        seconds={elapsed}
        offline={offline}
        last={runs.last}
      />
    );

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
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(type.titleSm, styles.title)}>
          <Icon name="claude" />
          Claude
        </h2>
        <span {...stylex.props(styles.grow)} />
        <Button variant="quiet" size="sm" icon="panel-right" iconOnly label="Fold the dock (Ctrl+J)" onClick={onFold} />
      </div>
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
            contexts={ctx}
            all={ctx.saved ?? []}
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
    </aside>
  );
}
