import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { FilterBar } from "../../components/filters/FilterBar.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { List } from "../../components/ui/List.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import {
  day,
  NO_RUNS_FILTER,
  RUNS_SORTS,
  type RunSummary,
  type RunsFilters,
  type RunsSort,
  runShare,
  runsOptions,
  shownRuns,
} from "./runs.ts";

const styles = stylex.create({
  head: { flex: "none", display: "flex", alignItems: "center", gap: space.s2, paddingInlineStart: space.s2 },
  title: { margin: 0 },
  grow: { flex: 1 },
  tools: { flex: "none", display: "flex", flexDirection: "column", gap: space.s2, paddingBlock: space.s3 },
  meta: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, paddingBlock: space.s1 },
  line: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, color: color.textMuted },
  words: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty: { color: color.textMuted },
});

function meta(r: RunSummary) {
  const c = r.counts;
  const share = (n: number) => (n / (r.total || 1)) * 100;
  const what = r.importedAt ? `Imported from pages · ${day(r.importedAt)}` : `by ${r.createdBy}`;
  return (
    <span {...stylex.props(styles.meta)}>
      <span {...stylex.props(styles.words)}>{what}</span>
      <Progress
        label={`Progress of ${r.name}`}
        segments={[
          { value: share(c.passed), tone: "success" },
          { value: share(c.problem), tone: "danger" },
          { value: share(c.blocked), tone: "warning" },
        ]}
      />
      <span {...stylex.props(styles.line)}>
        <span {...stylex.props(type.tabular, styles.words)}>
          {r.total - c.notRun}/{r.total} · {runShare(r)} %
        </span>
        {c.problem > 0 && <Badge label={String(c.problem)} tone="danger" icon="x-circle" size="sm" />}
        {c.blocked > 0 && <Badge label={String(c.blocked)} tone="warning" icon="alert-triangle" size="sm" />}
        {r.openQuestions > 0 && <Badge label={String(r.openQuestions)} tone="info" icon="info" size="sm" />}
        <span>{day(r.updatedAt ?? r.createdAt)}</span>
      </span>
    </span>
  );
}

// ponytail: the runs — the filter bar (words, state, who made it, what it has), sorted in the head, those still being played first; each with its bar split by
// result, how far it is, its problems, blocked tests and open questions
export function RunList({
  runs,
  selected,
  onOpen,
}: {
  runs: RunSummary[] | undefined;
  selected: string;
  onOpen: (slug: string) => void;
}) {
  const [filters, setFilters] = useState<RunsFilters>(NO_RUNS_FILTER);
  const [sort, setSort] = useState<RunsSort>("activity");
  if (!runs)
    return (
      <List
        label="Runs"
        items={[]}
        getKey={() => ""}
        renderItem={() => ({ title: "" })}
        loading={4}
        reading="runs.list"
      />
    );
  const shown = shownRuns(runs, filters, sort);
  const options = runsOptions(runs, filters);
  const open = shown.filter((r) => !r.finished).map((r) => r.slug);
  const done = shown.filter((r) => r.finished).map((r) => r.slug);
  const set = (k: keyof RunsFilters) => (v: string[]) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(type.titleSm, styles.title)}>Runs</h2>
        <Badge count size="sm" label={String(runs.length)} />
        <span {...stylex.props(styles.grow)} />
        <Select
          size="sm"
          appearance="quiet"
          label="Sort the runs"
          icon="sort"
          value={sort}
          onChange={setSort}
          options={RUNS_SORTS}
        />
      </div>
      <div {...stylex.props(styles.tools)}>
        <FilterBar
          label="Filter runs"
          placeholder="Filter — name, who made it"
          words={filters.words}
          onWords={(words) => setFilters((f) => ({ ...f, words }))}
          shown={shown.length}
          total={runs.length}
          onClear={() => setFilters(NO_RUNS_FILTER)}
          menus={[
            {
              key: "state",
              label: "State",
              options: options.states,
              selected: filters.states,
              onChange: set("states"),
            },
            { key: "by", label: "Made by", options: options.by, selected: filters.by, onChange: set("by") },
            {
              key: "has",
              label: "Has",
              options: options.has,
              selected: filters.has,
              onChange: set("has"),
              note: "Ticks add up: a run shows when it has any of them.",
            },
          ]}
        />
      </div>
      <List
        label="Runs"
        items={shown}
        getKey={(r) => r.slug}
        density="two-line"
        selected={selected || null}
        onSelect={onOpen}
        empty={<span {...stylex.props(type.small, styles.empty)}>No run matches.</span>}
        groups={
          sort === "activity"
            ? [
                ...(open.length ? [{ label: "In progress", meta: String(open.length), keys: open }] : []),
                ...(done.length ? [{ label: "Finished", meta: String(done.length), keys: done }] : []),
              ]
            : undefined
        }
        renderItem={(r) => ({ title: r.name, tooltip: r.name, meta: meta(r) })}
      />
    </>
  );
}
