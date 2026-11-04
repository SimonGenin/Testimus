import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { askedOf, ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { DiagnosisText } from "../../components/claude/DiagnosisText.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { type } from "../../components/ui/type.ts";
import { activityOf, DOING } from "../../lib/activity.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, container, size, space } from "../../styles/tokens.stylex.ts";
import { LandedCard } from "./GenCard.tsx";
import { checkLine, failedRun, GenSummary, RunHead } from "./GenResult.tsx";
import type { Generation } from "./useGeneration.ts";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlockStart: space.s6,
    paddingBlockEnd: space.s9,
    paddingInline: space.s7,
    containerType: "inline-size",
  },
  summary: { display: "flex", flexDirection: "column", gap: space.s4 },
  muted: { margin: 0, color: color.textMuted },
  cards: { display: "flex", flexDirection: "column", gap: space.s4 },
  split: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 3fr) minmax(0, 2fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  col: { minWidth: 0 },
  colHead: { display: "flex", alignItems: "center", gap: space.s2, minHeight: size.controlSm },
  colTitle: { margin: 0 },
  grow: { flex: 1 },
});

// ponytail: « Fold all » also folds the tests still to come; flip holds the cards toggled by hand since
type Fold = { all: boolean; flip: Set<string> };

export function ResultPane({
  gen,
  status,
  checking,
  noDocs,
  starting,
  onCheckClaude,
  onCancel,
  onResume,
  onRetry,
}: {
  gen: Generation;
  status: ClaudeStatus | null;
  checking: boolean;
  noDocs: boolean;
  starting: boolean;
  onCheckClaude: () => void;
  onCancel: () => void;
  onResume: (generation: string) => void;
  onRetry?: () => void;
}) {
  const app = useApp();
  const [fold, setFold] = useState<Fold>({ all: false, flip: new Set() });
  const [now, setNow] = useState(Date.now());
  const refs = useRead("tests.list", {}, { enabled: gen.ids.length > 0 });
  const { job, result, stopped, ids, running } = gen;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (status)
    return (
      <div {...stylex.props(styles.pane)}>
        <Card>
          <ConnectClaude
            status={status}
            checking={checking}
            onCheck={onCheckClaude}
            onDoctor={() => app.navigate("doctor")}
            onSetPath={() => app.navigate("settings", "claude-exe")}
          />
        </Card>
      </div>
    );
  if (!gen.jobId)
    return (
      <div {...stylex.props(styles.pane)}>
        {noDocs ? (
          <EmptyState
            wide
            icon="documents"
            title="Generate needs a document"
            text="Tests are written from the project's specifications, with a source for every expected result. Add a .docx or .pdf first."
            actions={
              <Button
                variant="primary"
                icon="documents"
                label="Go to Documents"
                onClick={() => app.navigate("documents")}
              />
            }
          />
        ) : (
          <EmptyState
            wide
            icon="generate"
            title="Tests appear here as Claude writes them"
            text="Pick the documents (all of them by default), say what to test if you want, and generate. Every expected result gets a source; what cannot be sourced is reported instead of invented."
          />
        )}
      </div>
    );

  const isOpen = (id: string) => fold.all === fold.flip.has(id);
  const toggle = (id: string) =>
    setFold((cur) => {
      const flip = new Set(cur.flip);
      if (!flip.delete(id)) flip.add(id);
      return { all: cur.all, flip };
    });
  const doing = DOING[activityOf(gen.events).at(-1)?.kind ?? "prepare"];
  const checkOf = (id: string) => result?.checks?.find((c) => c.id === id);
  const head = (
    <Card density="compact">
      <div {...stylex.props(styles.summary)}>
        <RunHead
          job={job}
          now={now}
          result={result}
          read={gen.read}
          count={ids.length}
          doing={doing}
          left={starting ? 0 : (stopped?.remaining ?? 0)}
          onCancel={onCancel}
          onReview={() => app.navigate("review", ids[0])}
          onResume={() => stopped?.generation && onResume(stopped.generation)}
          onRetry={onRetry}
          allFolded={ids.every((id) => !isOpen(id))}
          onFoldAll={(all) => setFold({ all, flip: new Set() })}
        />
        {result && <GenSummary result={result} checked={checkLine(result.tests, result.checks)} />}
        {result?.diagnosis && job && !failedRun(job, result) && (
          <p {...stylex.props(type.compact, styles.muted)}>
            <DiagnosisText text={result.diagnosis.detail} />
          </p>
        )}
      </div>
    </Card>
  );
  const cards = ids.map((id, i) => (
    <LandedCard
      key={id}
      id={id}
      refs={refs.data as LocalTestRef[] | undefined}
      check={checkOf(id)}
      writing={running && i === ids.length - 1}
      checking={running && i < ids.length - 1}
      xray={app.xray}
      open={isOpen(id)}
      onToggle={() => toggle(id)}
      onOpen={() => app.navigate("review", id)}
      onEdit={() => app.navigate("tests", id)}
      onSource={app.openSource}
    />
  ));
  const asked = askedOf(job, app.info?.project.claude);
  const activity = (
    <ClaudeActivity events={gen.events} running={running} now={now} model={asked.model} effort={asked.effort} />
  );
  return (
    <div {...stylex.props(styles.pane)}>
      {head}
      {running ? (
        <div {...stylex.props(styles.split)}>
          <div {...stylex.props(styles.col)}>{activity}</div>
          <section aria-label="Tests written" aria-live="polite" {...stylex.props(styles.col, styles.cards)}>
            <div {...stylex.props(styles.colHead)}>
              <h3 {...stylex.props(type.body, type.strong, styles.colTitle)}>Tests</h3>
              <Badge count size="sm" label={String(ids.length)} />
              <span {...stylex.props(styles.grow)} />
              <span {...stylex.props(type.compact, styles.muted)}>they land here as Claude writes them</span>
            </div>
            {ids.length ? (
              cards
            ) : (
              <Card>
                <EmptyState
                  compact
                  icon="tests"
                  title="No test written yet"
                  text="Claude reads first, then plans, then writes."
                />
              </Card>
            )}
          </section>
        </div>
      ) : (
        <>
          {ids.length > 0 && (
            <section aria-label="Tests written" aria-live="polite" {...stylex.props(styles.cards)}>
              {cards}
            </section>
          )}
          {activity}
        </>
      )}
    </div>
  );
}
