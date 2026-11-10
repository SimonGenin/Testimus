import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { askedOf, ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { DiagnosisText } from "../../components/claude/DiagnosisText.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { activityOf, DOING } from "../../lib/activity.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { color, container, space } from "../../styles/tokens.stylex.ts";
import { LandedCard } from "./GenCard.tsx";
import { checkLine, failedRun, GenSummary, RunHead } from "./GenResult.tsx";
import type { Generation } from "./useGeneration.ts";
import { useGenFixes } from "./useGenFixes.ts";
import { WritingTests } from "./WritingTests.tsx";

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
  fixes: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.claudeText },
  grow: { flex: "1 1 16rem", minWidth: 0, color: color.textMuted },
  cards: { display: "flex", flexDirection: "column", gap: space.s4 },
  split: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 3fr) minmax(0, 2fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  col: { minWidth: 0 },
});

// ponytail: « Fold all » folds everything the pane folds — what Claude did and what was not covered; all starts folded;
// flip holds what was toggled by hand since
type Fold = { all: boolean; flip: Set<string> };
const ACTIVITY = "activity";
const SKIPPED = "skipped";

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
  const [fold, setFold] = useState<Fold>({ all: true, flip: new Set() });
  const [now, setNow] = useState(Date.now());
  const refs = useRead("tests.list", { generating: true }, { enabled: gen.ids.length > 0 });
  const fixes = useGenFixes(gen.result?.generation ?? null);
  const [onlyFixes, setOnlyFixes] = useState(false);
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
          onOpenJob={job ? () => app.openJob(job.id) : undefined}
          onResume={() => stopped?.generation && onResume(stopped.generation)}
          onRetry={onRetry}
          allFolded={[ACTIVITY, ...(result?.skipped?.length ? [SKIPPED] : [])].every((id) => !isOpen(id))}
          onFoldAll={(all) => setFold({ all, flip: new Set() })}
        />
        {result && (
          <GenSummary
            result={result}
            checked={checkLine([...result.tests, ...(result.revised ?? [])], result.checks)}
            onOpenJob={job ? () => app.openJob(job.id) : undefined}
            open={isOpen(SKIPPED)}
            onOpenChange={(o) => o !== isOpen(SKIPPED) && toggle(SKIPPED)}
          />
        )}
        {fixes.count > 0 && !running && (
          <div {...stylex.props(type.compact, styles.fixes)}>
            <Icon name="claude" size="sm" />
            <span {...stylex.props(styles.grow)}>
              Claude proposes {fixes.count} {fixes.count === 1 ? "fix" : "fixes"} on{" "}
              {plural(fixes.tests.length, "test")}: each sits on its test below.
            </span>
            <Button
              size="sm"
              variant="quiet"
              pressed={onlyFixes}
              label={onlyFixes ? "Show all the tests" : `Show only these ${fixes.tests.length}`}
              onClick={() => setOnlyFixes(!onlyFixes)}
            />
          </div>
        )}
        {result?.diagnosis && job && !failedRun(job, result) && (
          <p {...stylex.props(type.compact, styles.muted)}>
            <DiagnosisText text={result.diagnosis.detail} />
          </p>
        )}
      </div>
    </Card>
  );
  const cards = (onlyFixes && fixes.count ? ids.filter((id) => fixes.tests.includes(id)) : ids).map((id) => (
    <LandedCard
      key={id}
      id={id}
      refs={refs.data as LocalTestRef[] | undefined}
      check={checkOf(id)}
      onOpen={() => app.navigate("review", id)}
      fixes={{ list: fixes.of(id), onFix: fixes.run, onDismiss: fixes.dismiss }}
    />
  ));
  const asked = askedOf(job, app.info?.project.claude);
  const activity = (
    <ClaudeActivity
      events={gen.events}
      running={running}
      now={now}
      model={asked.model}
      effort={asked.effort}
      open={isOpen(ACTIVITY)}
      onOpenChange={(o) => o !== isOpen(ACTIVITY) && toggle(ACTIVITY)}
    />
  );
  return (
    <div {...stylex.props(styles.pane)}>
      {head}
      {running ? (
        <div {...stylex.props(styles.split)}>
          <div {...stylex.props(styles.col)}>
            <WritingTests tests={gen.writing} />
          </div>
          <div {...stylex.props(styles.col)}>{activity}</div>
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
