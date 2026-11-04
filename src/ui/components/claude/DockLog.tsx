import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { useApp } from "../../lib/app.ts";
import { read, useRead } from "../../lib/data/query.ts";
import { plural, relTime } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import { type } from "../ui/type.ts";
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
    padding: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  intro: { display: "flex", flexDirection: "column", gap: space.s4, paddingTop: space.s6 },
  hint: { margin: 0, color: color.textMuted },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    color: color.textSubtle,
  },
});

const PROJECT = {
  title: "Ask about the project",
  text: "Ask anything about the project, or tell Claude what to do with its tests. Every change can be reverted.",
};

const intro = (sub: Sub, docId: string | null) =>
  sub === "doc" || sub === "all"
    ? `Ask the documents a question. Claude answers from ${sub === "doc" && docId ? docId : "the project's documents"} and cites the passages it used; a click on a source opens it.`
    : `Claude edits this ${sub === "step" ? "step" : "test"} in place. The editor reads the file back after the run, and Revert undoes the whole run.`;

const EARLIER = 5;

type ChatSummary = { id: string; title: string; updatedAt: string; turns: number };

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
  const client = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const onActions = tab === "actions";
  const visible = runs.turns.filter((t) => !!t.action === onActions);
  const count = runs.turns.length;
  const lastText = runs.turns[count - 1]?.text;
  useEffect(() => {
    if (count || lastText) scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [count, lastText]);

  const busy = runs.locked;
  const actions: TurnActions = {
    busy,
    onOpenSource: app.openSource,
    onShowChanges: (run) => {
      if (run.docId && !run.steps) app.navigate("documents", run.docId);
      else if (run.fix && run.testId) app.navigate("review", run.testId);
      else if (run.testId) app.navigate("tests", run.testId);
      else app.navigate("tests");
    },
    onRevert: (t) => void runs.revert(t),
    conflict: runs.refused && { id: runs.refused.turn.id, detail: runs.refused.detail },
    onForceRevert: (t) => void runs.revert(t, true),
    onKeepRevert: runs.keepAsIs,
    onToggleRaw: runs.toggleRaw,
    onRetry: (a) => void runs.execute(a),
    onSettings: () => app.navigate("settings", "claude"),
  };
  const asked = visible.filter((t) => t.role === "user").length;
  const docs = tab === "docs";
  const chats = useRead("chat.list", {}, { enabled: docs && !visible.length && !offline && !!app.info });
  const earlier = ((chats.data as ChatSummary[] | undefined) ?? []).slice(0, EARLIER);
  const open = async (id: string) => {
    try {
      runs.resume((await read(client, "chat.show", { chatId: id })) as Parameters<typeof runs.resume>[0]);
    } catch (e) {
      errorToast(e, "Could not open the conversation");
    }
  };

  return (
    <div ref={scroller} aria-live="polite" {...stylex.props(styles.body)}>
      {offline && status ? (
        <ConnectClaude
          look="dock"
          status={status}
          checking={checking}
          onCheck={onCheck}
          onDoctor={() => app.navigate("doctor")}
          onSetPath={() => app.navigate("settings", "claude-exe")}
        />
      ) : (
        <>
          {!onActions && asked > 0 && (
            <div {...stylex.props(type.small, styles.bar)}>
              <span>Conversation · {plural(asked, "request")}</span>
              <Button
                size="sm"
                variant="quiet"
                icon="plus"
                label="Start over"
                disabled={busy ? "Claude is working — wait for it to finish" : false}
                onClick={runs.clear}
              />
            </div>
          )}
          {onActions && actionsList}
          {!onActions && !visible.length && (
            <div {...stylex.props(styles.intro)}>
              {sub === "project" ? (
                <EmptyState icon="claude" title={PROJECT.title} text={PROJECT.text} />
              ) : (
                <p {...stylex.props(type.compact, styles.hint)}>{intro(sub, docId)}</p>
              )}
            </div>
          )}
          {docs && !visible.length && earlier.length > 0 && (
            <List
              label="Earlier conversations"
              items={earlier}
              getKey={(c) => c.id}
              groups={[{ label: "Earlier conversations", keys: earlier.map((c) => c.id) }]}
              onSelect={(id) => void open(id)}
              renderItem={(c) => ({
                title: c.title,
                tooltip: c.title,
                lead: <Icon name="history" />,
                trail: relTime(Date.parse(c.updatedAt)),
              })}
            />
          )}
          {visible.map((t) =>
            t.role === "user" ? (
              <UserTurn key={t.id} turn={t} />
            ) : t.action ? (
              <ActionCard
                key={t.id}
                action={t.action}
                ready={false}
                busy={busy}
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
