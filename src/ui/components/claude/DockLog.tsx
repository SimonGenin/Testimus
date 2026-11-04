import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useRef } from "react";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ActionCard } from "./ActionCard.tsx";
import { type ClaudeStatus, ConnectClaude } from "./ConnectClaude.tsx";
import type { Sub, Tab } from "./DockScope.tsx";
import { AnswerTurn, type TurnActions, UserTurn } from "./DockTurn.tsx";
import type { useDockRuns } from "./useDockRuns.ts";

const styles = stylex.create({
  body: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: space.s4,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textSubtle,
  },
});

const EMPTY: Record<Sub, { title: string; text: string }> = {
  doc: { title: "Ask anything about this document", text: "Answers come with the passages they rely on." },
  all: { title: "Ask the documents", text: "Answers come with the passages they rely on." },
  project: {
    title: "Ask about the project",
    text: "Ask anything about the project, or tell Claude what to do with its tests. Every change can be reverted.",
  },
  test: {
    title: "Ask about this test",
    text: "Claude edits this test in place. The editor reads the file back after the run, and Revert undoes the whole run.",
  },
  step: {
    title: "Ask about this step",
    text: "Claude edits this step in place. The editor reads the file back after the run, and Revert undoes the whole run.",
  },
};

// ponytail: the dock's conversation — what was asked and what Claude did, the action runs under the Actions tab,
// the connect panel when Claude is not there
export function DockLog({
  runs,
  tab,
  sub,
  docId,
  offline,
  status,
  checking,
  onCheck,
  actionsList,
}: {
  runs: ReturnType<typeof useDockRuns>;
  tab: Tab;
  sub: Sub;
  docId: string | null;
  offline: boolean;
  status: ClaudeStatus | undefined;
  checking: boolean;
  onCheck: () => void;
  actionsList: ReactNode;
}) {
  const app = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const onActions = tab === "actions";
  const visible = runs.turns.filter((t) => !!t.action === onActions);
  const count = runs.turns.length;
  const lastText = runs.turns[count - 1]?.text;
  useEffect(() => {
    if (count || lastText) scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [count, lastText]);

  const actions: TurnActions = {
    busy: runs.busy,
    onOpenSource: app.openSource,
    onShowChanges: (run) =>
      run.docId && !run.steps ? app.navigate("documents", run.docId) : app.navigate("tests", run.testId),
    onRevert: (t) => void runs.revert(t),
    onToggleRaw: runs.toggleRaw,
    onRetry: (a) => void runs.execute(a),
    onSettings: () => app.navigate("settings", "claude"),
  };
  const asked = visible.filter((t) => t.role === "user").length;
  const empty =
    sub === "doc" && docId
      ? { ...EMPTY.doc, title: `Ask anything about ${docId}` }
      : EMPTY[sub === "doc" ? "all" : sub];

  return (
    <div ref={scroller} aria-live="polite" {...stylex.props(styles.body)}>
      {offline && status ? (
        <ConnectClaude
          status={status}
          checking={checking}
          onCheck={onCheck}
          onDoctor={() => app.navigate("doctor")}
          onSetPath={() => app.navigate("settings", "claude-exe")}
        />
      ) : (
        <>
          {!onActions && asked > 0 && (
            <div {...stylex.props(styles.bar)}>
              <span>Conversation · {plural(asked, "request")}</span>
              <Button
                size="sm"
                variant="quiet"
                icon="plus"
                label="Start over"
                disabled={runs.busy ? "Claude is working — wait for it to finish" : false}
                onClick={runs.clear}
              />
            </div>
          )}
          {onActions && actionsList}
          {!onActions && !visible.length && <EmptyState icon="claude" title={empty.title} text={empty.text} compact />}
          {visible.map((t) =>
            t.role === "user" ? (
              <UserTurn key={t.id} turn={t} />
            ) : t.action ? (
              <ActionCard
                key={t.id}
                action={t.action}
                ready={false}
                busy={runs.busy}
                model=""
                effort="high"
                meta={t.meta && !t.running ? `${t.meta.model || "default"} · ${t.meta.effort}` : undefined}
                onModel={() => {}}
                onEffort={() => {}}
                onRun={() => {}}
                onLater={() => {}}
                onDismiss={() => {}}
              >
                <AnswerTurn turn={t} actions={actions} />
              </ActionCard>
            ) : (
              <AnswerTurn key={t.id} turn={t} actions={actions} />
            ),
          )}
        </>
      )}
    </div>
  );
}
