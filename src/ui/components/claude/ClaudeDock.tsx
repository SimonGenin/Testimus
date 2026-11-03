import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ClaudeScope, Effort } from "../../../core/types.ts";
import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { key, read, useRead } from "../../lib/data/query.ts";
import {
  border,
  breakpoint,
  color,
  fontSize,
  fontWeight,
  radius,
  shadow,
  size,
  space,
  z,
} from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Modal.tsx";
import type { ClaudeStatus } from "./ConnectClaude.tsx";
import { useContexts } from "./contexts.ts";
import { DockActions, useActionChoices } from "./DockActions.tsx";
import { DockComposer, runIds } from "./DockComposer.tsx";
import { DockFolded } from "./DockFolded.tsx";
import { DockLog } from "./DockLog.tsx";
import { DockScope, type Sub, type Tab } from "./DockScope.tsx";
import { OnTopToggle } from "./OnTopToggle.tsx";
import { type Again, docOfRoute } from "./turns.ts";
import { type DockJob, useDockRuns } from "./useDockRuns.ts";
import { useNow } from "./useNow.ts";

export { docOfRoute, fixOutcome, metaLine, PROJECT_RUN, toolLabel, transcript } from "./turns.ts";
export type { DockJob } from "./useDockRuns.ts";

export type DockRequest = {
  mode: "docs" | "test";
  scope?: "test" | "step" | "project";
  prompt?: string;
  job?: DockJob;
  nonce: number;
};

const styles = stylex.create({
  dock: {
    flex: "none",
    boxSizing: "border-box",
    width: `var(--dock-size, ${size.dock})`,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderInlineStartStyle: "solid",
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
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: size.topbar,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    color: color.claudeText,
  },
  grow: { flex: 1 },
  foot: {
    flex: "none",
    padding: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    backgroundColor: color.canvas,
  },
});

const placeholderOf = (sub: Sub, docId: string | null) =>
  sub === "doc"
    ? `Ask anything about ${docId}…`
    : sub === "all"
      ? "Ask the documents — answers cite their passages"
      : sub === "project"
        ? "Ask about the project, or tell Claude what to do with its tests…"
        : "Ask Claude to change or explain this test…";

const labelOf = (sub: Sub, docId: string | null) =>
  sub === "doc"
    ? `Ask about ${docId}`
    : sub === "all"
      ? "Ask the documents"
      : sub === "project"
        ? "Ask Claude about the project"
        : "Ask Claude about this test";

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
  const [tab, setTab] = useState<Tab>("test");
  const [sub, setSub] = useState<Sub>("project");
  const [model, setModel] = useState(cfg?.model ?? "opus");
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? "high");
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const choices = useActionChoices({ model: cfg?.model ?? "opus", effort: cfg?.effort ?? "high" });
  const now = useNow(runs.started !== null);
  const [, setPrompt] = useDraft([project(), "dock.prompt"]);
  const [focusAsk, setFocusAsk] = useState(0);

  const statusRead = useRead("claude.status", {});
  const status = statusRead.data as ClaudeStatus | undefined;
  const offline = !!status && (!status.installed || status.signedIn === false);
  const notInstalled = !!status && !status.installed;

  const testId = focus?.testId;
  const onProject = tab === "test" && sub === "project";
  const ofProject = useRead("contexts.ofProject", {}, { enabled: !!projectDir && onProject });
  const ofTest = useRead(
    "contexts.ofTest",
    { testId: testId ?? "" },
    { enabled: !!projectDir && !onProject && !!testId },
  );
  const effectiveOf = (r: typeof ofProject | typeof ofTest) =>
    (r.data as { effective?: string[] } | undefined)?.effective;
  const saved = useContexts(!!projectDir);
  const effective = (
    tab !== "test" ? [] : ((onProject ? effectiveOf(ofProject) : testId ? effectiveOf(ofTest) : cfg?.contexts) ?? [])
  ).filter((id) => !saved?.length || saved.some((c) => c.id === id));
  const known = tab !== "test" || (onProject ? !!ofProject.data : testId ? !!ofTest.data : !!cfg?.contexts);

  const actionsRead = useRead("actions.list", {}, { enabled: !!projectDir });
  const inRun = new Set(runs.turns.filter((t) => t.action && t.running).map((t) => t.action?.id));
  const actions = ((actionsRead.data as unknown as Action[] | undefined) ?? []).filter(
    (a) => a.state === "open" && !inRun.has(a.id),
  );

  useEffect(() => {
    if (cfg?.model) setModel(cfg.model);
    if (cfg?.effort) setEffort(cfg.effort);
  }, [cfg?.model, cfg?.effort]);

  useEffect(() => {
    setTab((t) => (t === "actions" ? t : testId ? "test" : docId ? "docs" : "test"));
    setSub(testId ? "test" : docId ? "doc" : "project");
  }, [testId, docId]);

  useEffect(() => {
    if (focus?.step == null && sub === "step") setSub("test");
    if (!focus && (sub === "step" || sub === "test")) setSub("project");
    if (!docId && sub === "doc") setSub("all");
  }, [focus, docId, sub]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope or another test starts from its own contexts
  useEffect(() => setPick({}), [tab, sub, testId, docId]);

  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    if (request.mode === "docs") {
      setTab(docId ? "docs" : "test");
      setSub(docId ? "doc" : "project");
    } else if (request.scope) {
      setTab("test");
      setSub(request.scope);
    }
    if (request.job) {
      void runs.runJob(request.job);
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

  const scopeOf = (): ClaudeScope =>
    sub === "step" && focus && focus.step != null
      ? { kind: "step", testId: focus.testId, step: focus.step }
      : sub === "test" && focus
        ? { kind: "test", testId: focus.testId }
        : { kind: "project" };
  const scopeWord =
    sub === "step" && focus?.step != null
      ? `Step ${focus.step}`
      : sub === "test" && focus
        ? (focus.key ?? "This test")
        : sub === "doc" && docId
          ? docId
          : sub === "all"
            ? "All documents"
            : "Whole project";
  const docsMode = tab === "docs";

  const send = (text: string, note: string, quickAsk?: string) => {
    const q = text.trim();
    // ponytail: on a test or the project an empty box still runs — the scope and the house rules are the request
    // (Xray Editor); a question to the documents needs words
    if ((!q && docsMode) || runs.busy) return;
    const n = note.trim();
    const a: Again = docsMode
      ? {
          mode: "docs",
          text: q,
          model,
          effort,
          contexts: runIds({ effective, pick, setPick }),
          note:
            [
              sub === "doc" && docId
                ? `The question is about the document ${docId}: answer from docs/${docId}/doc.md first.`
                : "",
              n,
            ]
              .filter(Boolean)
              .join("\n") || undefined,
          label: sub === "doc" && docId ? docId : undefined,
        }
      : {
          mode: "test",
          text: q,
          scope: scopeOf(),
          contexts: known || Object.keys(pick).length ? runIds({ effective, pick, setPick }) : undefined,
          note: n || undefined,
          label: `${scopeWord}${quickAsk ? ` · ${quickAsk}` : ""}`,
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
        offline={notInstalled}
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
        <h2 {...stylex.props(styles.title)}>
          <Icon name="claude" />
          Claude
        </h2>
        {notInstalled && (
          <Badge
            tone="warning"
            size="sm"
            label="not connected"
            tooltip="Claude is optional — everything else works without it"
          />
        )}
        <span {...stylex.props(styles.grow)} />
        <OnTopToggle />
        <Button variant="quiet" size="sm" icon="panel-right" iconOnly label="Fold the dock (Ctrl+J)" onClick={onFold} />
      </div>
      <DockScope
        tab={tab}
        sub={sub}
        docId={docId}
        focus={focus}
        actions={actions.length}
        running={runs.busy}
        onTab={(t) => {
          setTab(t);
          if (t === "docs") setSub(docId ? "doc" : "all");
          if (t === "test") setSub(focus ? (focus.step != null && sub === "step" ? "step" : "test") : "project");
        }}
        onSub={setSub}
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
            busy={runs.busy}
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
            label={labelOf(sub, docId)}
            placeholder={offline ? "Claude is optional — everything else works without it" : placeholderOf(sub, docId)}
            scope={sub === "test" && focus ? "Whole test" : scopeWord}
            quickAsks={cfg?.presets ?? []}
            contexts={{ effective, pick, setPick }}
            all={saved ?? []}
            model={model}
            effort={effort}
            running={runs.busy ? elapsed : null}
            unavailable={offline ? "Claude is not connected" : undefined}
            onModel={setModel}
            onEffort={setEffort}
            onCancel={runs.jobId ? runs.cancel : undefined}
            onSend={send}
            keepAfterSend={!docsMode}
            focusKey={focusAsk}
          />
        </div>
      )}
      {runs.refused && (
        <Modal
          title="Revert anyway?"
          size="sm"
          icon="undo"
          subtitle="The test changed after the Claude run."
          confirm={{
            verb: "Revert anyway",
            danger: true,
            onConfirm: () => (runs.refused ? runs.revert(runs.refused.turn, true) : undefined),
          }}
          consequences={[["", "Reverting puts back the version from before Claude and drops the later edits too."]]}
          onClose={runs.keepAsIs}
        >
          {runs.refused.detail}
        </Modal>
      )}
    </aside>
  );
}
