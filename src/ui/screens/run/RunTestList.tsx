import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { List } from "../../components/ui/List.tsx";
import { Menu } from "../../components/ui/Menu.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { border, breakpoint, color, container, size, space } from "../../styles/tokens.stylex.ts";
import {
  countOf,
  folderGroups,
  inProgress,
  type RunTestView,
  type RunView,
  shownTests,
  TEST_FILTERS,
  TEST_SORTS,
  TEST_VIEW,
  type TestView,
} from "./runs.ts";
import { StepDots } from "./StepDots.tsx";

const styles = stylex.create({
  side: {
    boxSizing: "border-box",
    flex: "none",
    display: { default: "flex", [container.reviewQueue]: "none" },
    width: { default: size.sidebar, [breakpoint.sm]: "auto" },
    minHeight: 0,
    flexDirection: "column",
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: border.width,
    borderInlineEndColor: color.border,
  },
  head: {
    flex: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s4,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  name: { margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { color: color.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tools: { flex: "none", display: "flex", flexDirection: "column", gap: space.s2, padding: space.s3 },
  row: { display: "flex", alignItems: "center", gap: space.s1 },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s1, margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  grow: { flex: 1 },
  body: { flex: 1, minHeight: 0, overflowY: "auto", paddingInline: space.s2, paddingBottom: space.s4 },
  rowMeta: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
});

const IN_PROGRESS = { label: "In progress", tone: "accent", icon: "circle-dot" } as const;

function itemOf(t: RunTestView, n: number) {
  const r = t.result;
  const word = inProgress(t) ? IN_PROGRESS : RUN_STATUS[r.status];
  return {
    title: t.summary,
    tooltip: t.summary,
    wrap: true,
    meta: (
      <span {...stylex.props(styles.rowMeta)}>
        <span {...stylex.props(type.tabular)}>{n}</span>
        <Badge {...word} size="sm" />
        <StepDots steps={r.steps} />
        {r.openQuestions > 0 && <Badge label={String(r.openQuestions)} icon="info" tone="info" size="sm" />}
        {r.attachments.length > 0 && <Badge label={String(r.attachments.length)} icon="image" size="sm" />}
      </span>
    ),
  };
}

// ponytail: the run's tests beside the one being played — the run's body is a container of Review's width rule (three
// panes beside the dock, the same squeeze): under it the list goes and the bar's back button stays — how far the run is, the tests by folder with their result
// and their step marks, the same filters and sort as the run's table (one view, kept while the tester moves on)
export function RunTestList({
  run,
  open,
  view,
  onView,
  onOpen,
  me,
  onBack,
}: {
  /** who records results here (runs.list): « Only tests I ran » */
  me: string;
  run: RunView;
  open: string;
  view: TestView;
  onView: (v: TestView) => void;
  onOpen: (testId: string) => void;
  onBack: () => void;
}) {
  const c = run.counts;
  const total = run.tests.length || 1;
  const share = (n: number) => (n / total) * 100;
  const shown = shownTests(run.tests, view, me);
  const number = new Map(run.tests.map((t, i) => [t.id, i + 1]));
  const done = run.tests.length - c.notRun;
  const set = (patch: Partial<TestView>) => onView({ ...view, ...patch });
  const sortLabel = TEST_SORTS.find((s) => s.value === view.sort)?.label ?? "";
  return (
    <nav aria-label="Tests of the run" {...stylex.props(styles.side)}>
      <div {...stylex.props(styles.head)}>
        <span>
          <Button variant="link" size="sm" icon="arrow-left" label="The run" onClick={onBack} />
        </span>
        <h2 title={run.name} {...stylex.props(type.titleSm, styles.name)}>
          {run.name}
        </h2>
        {(run.version || run.environment) && (
          <span {...stylex.props(type.small, styles.meta)}>
            {[run.version, run.environment].filter(Boolean).join(" · ")}
          </span>
        )}
        <Progress
          label="Run progress"
          detail={`${done} of ${run.tests.length} done`}
          segments={[
            { value: share(c.passed), tone: "success" },
            { value: share(c.problem), tone: "danger" },
            { value: share(c.blocked), tone: "warning" },
          ]}
        />
      </div>
      <div {...stylex.props(styles.tools)}>
        <Text
          size="sm"
          icon="filter"
          ariaLabel="Filter the tests of the run"
          placeholder="Filter tests — words, step text"
          value={view.words}
          onChange={(words) => set({ words })}
        />
        <div {...stylex.props(styles.row)}>
          <Menu
            label="Sort and show"
            trigger={
              <Button size="sm" variant="quiet" icon="sort" iconAfter="chevron-down" label={`Sort: ${sortLabel}`} />
            }
            entries={[
              { group: "Sort by" },
              ...TEST_SORTS.map((s) => ({
                label: s.label,
                checked: view.sort === s.value,
                onSelect: () => set({ sort: s.value }),
              })),
              "separator",
              { group: "Show" },
              {
                label: "Group by folder",
                icon: "folder-open",
                checked: view.group,
                keepOpen: true,
                onSelect: () => set({ group: !view.group }),
              },
              {
                label: "Only with screenshots",
                icon: "image",
                checked: view.shots,
                keepOpen: true,
                onSelect: () => set({ shots: !view.shots }),
              },
              {
                label: "Only tests I ran",
                icon: "check-circle",
                hint: me || undefined,
                checked: view.mine,
                keepOpen: true,
                disabled: me ? false : "Who runs the tests here is not known yet",
                onSelect: () => set({ mine: !view.mine }),
              },
              "separator",
              { label: "Reset sort and filters", icon: "undo", onSelect: () => onView(TEST_VIEW) },
            ]}
          />
          <span {...stylex.props(styles.grow)} />
        </div>
        <fieldset aria-label="Show the tests" {...stylex.props(styles.chips)}>
          {TEST_FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={`${f.label} ${countOf(run.tests, f.value)}`}
              pressed={view.filter === f.value}
              onToggle={() => set({ filter: f.value })}
            />
          ))}
        </fieldset>
      </div>
      <div {...stylex.props(styles.body)}>
        <List
          label="Tests"
          items={shown}
          getKey={(t) => t.id}
          density="two-line"
          selected={open}
          onSelect={onOpen}
          groups={
            view.group && folderGroups(shown).length
              ? folderGroups(shown).map((g) => ({ label: g.label, meta: `${g.done}/${g.keys.length}`, keys: g.keys }))
              : undefined
          }
          empty={<span {...stylex.props(type.small, styles.meta)}>No test matches.</span>}
          renderItem={(t) => itemOf(t, number.get(t.id) ?? 0)}
        />
      </div>
    </nav>
  );
}
