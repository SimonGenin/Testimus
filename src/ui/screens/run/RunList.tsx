import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { List } from "../../components/ui/List.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import {
  day,
  keepRun,
  RUNS_SORTS,
  type RunSummary,
  type RunsFilter,
  type RunsSort,
  runShare,
  shownRuns,
} from "./runs.ts";

const styles = stylex.create({
  tools: { flex: "none", display: "flex", flexDirection: "column", gap: space.s2, paddingBottom: space.s3 },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s1, margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  meta: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, paddingBlock: space.s1 },
  line: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, color: color.textMuted },
  words: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty: { color: color.textMuted },
});

const FILTERS: { value: RunsFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "In progress" },
  { value: "finished", label: "Finished" },
  { value: "questions", label: "With questions" },
];

function meta(r: RunSummary) {
  const c = r.counts;
  const share = (n: number) => (n / (r.total || 1)) * 100;
  const what = r.importedAt
    ? `Imported from pages · ${day(r.importedAt)}`
    : [r.version, r.environment].filter(Boolean).join(" · ") || `by ${r.createdBy}`;
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

// ponytail: the runs — filtered by words and state, sorted, those still being played first; each with its bar split by
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
  const [filter, setFilter] = useState<RunsFilter>("all");
  const [words, setWords] = useState("");
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
  const shown = shownRuns(runs, filter, words, sort);
  const open = shown.filter((r) => !r.finished).map((r) => r.slug);
  const done = shown.filter((r) => r.finished).map((r) => r.slug);
  return (
    <>
      <div {...stylex.props(styles.tools)}>
        <Text
          size="sm"
          icon="filter"
          ariaLabel="Filter runs"
          placeholder="Filter runs — name, version, place"
          value={words}
          onChange={setWords}
        />
        <Select
          size="sm"
          appearance="quiet"
          label="Sort the runs"
          prefix="Sort"
          icon="sort"
          value={sort}
          onChange={setSort}
          options={RUNS_SORTS}
        />
        <fieldset aria-label="Show the runs" {...stylex.props(styles.chips)}>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={`${f.label} ${runs.filter(keepRun[f.value]).length}`}
              pressed={filter === f.value}
              onToggle={() => setFilter(f.value)}
            />
          ))}
        </fieldset>
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
