import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
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
import { color, space } from "../../styles/tokens.stylex.ts";
import { checkLine, failedRun, GenSummary, RunHead } from "./GenResult.tsx";
import { GenTests } from "./GenTests.tsx";
import { landedRows, writingRows } from "./genRows.ts";
import { PlanReview } from "./PlanReview.tsx";
import type { Generation } from "./useGeneration.ts";
import { useGenFixes } from "./useGenFixes.ts";

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
});

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
  plan,
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
  /** a plan waiting for the user's go: revising and writing it */
  plan?: Omit<Parameters<typeof PlanReview>[0], "generation" | "failed">;
}) {
  const app = useApp();
  const [now, setNow] = useState(Date.now());
  const refs = useRead("tests.list", { generating: true }, { enabled: gen.ids.length > 0 || gen.running });
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

  const doing = DOING[activityOf(gen.events).at(-1)?.kind ?? "prepare"];
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
        />
        {result && (
          <GenSummary
            result={result}
            checked={checkLine([...result.tests, ...(result.revised ?? [])], result.checks)}
            onOpenJob={job ? () => app.openJob(job.id) : undefined}
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
  const listed = refs.data as LocalTestRef[] | undefined;
  const shownIds = onlyFixes && fixes.count ? ids.filter((id) => fixes.tests.includes(id)) : ids;
  const ended = !running ? (result ?? stopped) : null;
  if (ended?.state === "planned" && ended.generation && plan)
    return (
      <div {...stylex.props(styles.pane)}>
        <PlanReview generation={ended.generation} failed={ended.ok === false ? ended.summary : undefined} {...plan} />
      </div>
    );
  return (
    <div {...stylex.props(styles.pane)}>
      {head}
      {running ? (
        <GenTests
          rows={writingRows(gen.writing, listed)}
          running
          refs={listed}
          onReview={(id) => app.navigate("review", id)}
        />
      ) : (
        ids.length > 0 && (
          <GenTests
            rows={landedRows(shownIds, listed)}
            running={false}
            refs={listed}
            checks={result?.checks}
            fixes={fixes}
            onReview={(id) => app.navigate("review", id)}
          />
        )
      )}
    </div>
  );
}
