import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS, SYNC } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import {
  byLine,
  countOf,
  folderGroups,
  inProgress,
  marksLine,
  notesLine,
  type RunTestView,
  type RunView,
  shownTests,
  TEST_FILTERS,
  TEST_SORTS,
  type TestFilter,
  type TestSort,
  type TestView,
} from "./runs.ts";
import { StepDots } from "./StepDots.tsx";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s4 },
  bar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  grow: { flex: 1 },
  search: { width: "14rem", maxWidth: "100%" },
  group: { display: "flex", flexDirection: "column", gap: space.s2 },
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    paddingTop: space.s3,
    paddingInline: space.s4,
    color: color.textMuted,
  },
  groupName: { color: color.text },
  cellTitle: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1, textAlign: "start" },
  cell: { display: "inline-flex", alignItems: "center", gap: space.s2, whiteSpace: "nowrap" },
  muted: { color: color.textMuted },
});

const IN_PROGRESS = { label: "In progress", tone: "accent", icon: "circle-dot" } as const;
const SORT_OF_COLUMN: Record<string, TestSort> = { test: "folder", result: "result", by: "change", steps: "left" };

// ponytail: the tests of the run — tabs by result, words, a sort (also by a column's head), by folder or not; a row
// opens the test to run it
export function RunTable({
  run,
  view,
  onView,
  onOpenTest,
  me,
}: {
  me: string;
  run: RunView;
  view: TestView;
  onView: (v: TestView) => void;
  onOpenTest: (testId: string) => void;
}) {
  const set = (patch: Partial<TestView>) => onView({ ...view, ...patch });
  const shown = shownTests(run.tests, view, me);
  const number = new Map(run.tests.map((t, i) => [t.id, i + 1]));
  const groups = view.group ? folderGroups(shown) : [];
  const columnSorted = Object.entries(SORT_OF_COLUMN).find(([, s]) => s === view.sort)?.[0];
  const table = (rows: RunTestView[], label: string) => (
    <Table
      label={label}
      rows={rows}
      getKey={(t) => t.id}
      onRowSelect={onOpenTest}
      sort={columnSorted ? { key: columnSorted, dir: "asc" } : undefined}
      onSort={(key) => set({ sort: view.sort === SORT_OF_COLUMN[key] ? "run" : SORT_OF_COLUMN[key] })}
      empty={<EmptyState icon="filter" title="No test matches" compact />}
      columns={[
        {
          key: "test",
          label: "Test",
          sortable: true,
          render: (t) => (
            <span {...stylex.props(styles.cellTitle)}>
              <span>{t.summary}</span>
              <span {...stylex.props(type.small, styles.cell, styles.muted)}>
                <span {...stylex.props(type.tabular)}>{number.get(t.id)}</span>
                {t.key ? <span {...stylex.props(type.mono)}>{t.key}</span> : <Badge {...SYNC.local} size="sm" />}
              </span>
            </span>
          ),
        },
        {
          key: "result",
          label: "Result",
          sortable: true,
          width: "9rem",
          render: (t) => <Badge {...(inProgress(t) ? IN_PROGRESS : RUN_STATUS[t.result.status])} size="sm" />,
        },
        {
          key: "steps",
          label: "Steps",
          sortable: true,
          width: "14rem",
          render: (t) => (
            <span {...stylex.props(type.small, styles.cell)}>
              <StepDots steps={t.result.steps} />
              {marksLine(t.result)}
            </span>
          ),
        },
        {
          key: "notes",
          label: "Notes",
          render: (t) => (
            <span {...stylex.props(type.small, styles.cell, styles.muted)}>
              {notesLine(t.result)}
              {t.result.attachments.length > 0 && (
                <Badge label={String(t.result.attachments.length)} icon="image" size="sm" />
              )}
            </span>
          ),
        },
        {
          key: "by",
          label: "Last change",
          sortable: true,
          width: "9rem",
          render: (t) => <span {...stylex.props(type.small)}>{byLine(t.result)}</span>,
        },
      ]}
    />
  );
  return (
    <div {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.bar)}>
        <Tabs<TestFilter>
          size="sm"
          label="Show the tests"
          value={view.filter}
          onChange={(filter) => set({ filter })}
          tabs={TEST_FILTERS.map((f) => ({ value: f.value, label: f.label, count: countOf(run.tests, f.value) }))}
        />
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(styles.search)}>
          <Text
            size="sm"
            ariaLabel="Filter tests"
            icon="filter"
            placeholder="Filter tests"
            value={view.words}
            onChange={(words) => set({ words })}
          />
        </span>
        <Select
          size="sm"
          appearance="quiet"
          label="Sort the tests"
          prefix="Sort"
          icon="sort"
          value={view.sort}
          onChange={(sort) => set({ sort })}
          options={TEST_SORTS}
        />
        <Button
          size="sm"
          variant="quiet"
          icon="check-circle"
          iconOnly
          label={me ? `Only tests I ran (${me})` : "Only tests I ran"}
          pressed={view.mine}
          disabled={me ? false : "Who runs the tests here is not known yet"}
          onClick={() => set({ mine: !view.mine })}
        />
        <Button
          size="sm"
          variant="quiet"
          icon="folder"
          iconOnly
          label="Group by folder"
          pressed={view.group}
          onClick={() => set({ group: !view.group })}
        />
      </div>
      {groups.length ? (
        groups.map((g) => (
          <Card key={g.label} padded={false} label={g.label}>
            <div {...stylex.props(styles.group)}>
              <h3 {...stylex.props(type.small, styles.groupHead)}>
                <Icon name="folder-open" size="sm" />
                <span {...stylex.props(type.strong, styles.groupName)}>{g.label}</span>
                {g.done} of {g.keys.length} done
              </h3>
              {table(
                g.keys.map((k) => shown.find((t) => t.id === k) as RunTestView),
                `Tests of the run — ${g.label}`,
              )}
            </div>
          </Card>
        ))
      ) : (
        <Card padded={false}>{table(shown, "Tests of the run")}</Card>
      )}
    </div>
  );
}
