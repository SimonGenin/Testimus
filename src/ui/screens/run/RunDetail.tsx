import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { Badge, RUN_STATUS, SYNC } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { RunProgress } from "./RunProgress.tsx";
import { byLine, day, nextNotRun, notesLine, type RunTestView, type RunView, stepsLine } from "./runs.ts";

const styles = stylex.create({
  detail: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    paddingBlock: space.s6,
    paddingInline: space.s7,
  },
  head: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: space.s4 },
  titles: { flex: "1 1 20rem", minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: { margin: 0 },
  muted: { color: color.textMuted },
  mono: { color: color.textMuted },
  filters: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  spacer: { flex: 1 },
  search: { width: size.sidebar, maxWidth: "100%" },
  cellTitle: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1, textAlign: "start" },
  note: { color: color.textMuted },
  explain: { maxWidth: size.reading, color: color.textSubtle },
});

type Filter = "all" | "not-run" | "problems" | "questions";

const keep: Record<Filter, (t: RunTestView) => boolean> = {
  all: () => true,
  "not-run": (t) => t.result.status === "not-run",
  problems: (t) => t.result.status === "problem",
  questions: (t) => t.result.openQuestions > 0,
};

// ponytail: one run — who made it and for what version, how far it is, and its tests with their results; a row opens
// the test to run it, Continue the next one not run yet
export function RunDetail({
  run,
  onOpenTest,
  actions,
}: {
  run: RunView;
  onOpenTest: (testId: string) => void;
  actions?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [words, setWords] = useState("");
  const q = words.trim().toLowerCase();
  const shown = run.tests.filter(
    (t) => keep[filter](t) && (!q || `${t.summary} ${t.key ?? ""} ${t.id}`.toLowerCase().includes(q)),
  );
  const count = (f: Filter) => run.tests.filter(keep[f]).length;
  const next = nextNotRun(run.tests);
  const meta = [
    run.version && `Version under test ${run.version}`,
    run.environment,
    `started ${day(run.createdAt)} by ${run.createdBy}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section aria-label={`Run ${run.name}`} {...stylex.props(styles.detail)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titles)}>
          <h2 {...stylex.props(type.titleLg, styles.title)}>{run.name}</h2>
          <span {...stylex.props(type.small, styles.muted)}>{meta}</span>
        </div>
        {actions}
        <Button
          variant="primary"
          size="sm"
          label={next ? "Continue — next test not run" : "Every test has a result"}
          disabled={!next}
          onClick={() => next && onOpenTest(next.id)}
        />
      </div>
      <RunProgress run={run} questions={run.tests.reduce((n, t) => n + t.result.openQuestions, 0)} />
      <div {...stylex.props(styles.filters)}>
        <Segmented
          size="sm"
          label="Show the tests"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: run.tests.length },
            { value: "not-run", label: "Not run", count: count("not-run") },
            { value: "problems", label: "Problems", count: count("problems") },
            { value: "questions", label: "With questions", count: count("questions") },
          ]}
        />
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.search)}>
          <Text ariaLabel="Filter tests" icon="search" placeholder="Filter tests" value={words} onChange={setWords} />
        </span>
      </div>
      <Table
        label="Tests of the run"
        rows={shown}
        getKey={(t) => t.id}
        onRowSelect={onOpenTest}
        empty={<EmptyState icon="filter" title="No test matches" compact />}
        columns={[
          {
            key: "test",
            label: "Test",
            render: (t) => (
              <span {...stylex.props(styles.cellTitle)}>
                <span>{t.summary}</span>
                {t.key ? (
                  <span {...stylex.props(type.small, type.mono, styles.mono)}>{t.key}</span>
                ) : (
                  <Badge {...SYNC.local} size="sm" />
                )}
              </span>
            ),
          },
          { key: "result", label: "Result", render: (t) => <Badge {...RUN_STATUS[t.result.status]} size="sm" /> },
          {
            key: "steps",
            label: "Steps",
            render: (t) => <span {...stylex.props(type.small)}>{stepsLine(t.result)}</span>,
          },
          {
            key: "notes",
            label: "Notes",
            render: (t) => <span {...stylex.props(type.small, styles.note)}>{notesLine(t.result)}</span>,
          },
          { key: "by", label: "By", render: (t) => <span {...stylex.props(type.small)}>{byLine(t.result)}</span> },
        ]}
      />
      <p {...stylex.props(type.small, styles.explain, styles.title)}>
        A run is a frozen copy of its tests as they were when it was made: a test edited later does not change what is
        run. It is a folder of the project (test-runs/), shared like the tests; Claude reads it, never marks a result.
      </p>
    </section>
  );
}
