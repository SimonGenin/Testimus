import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { size, space } from "../../styles/tokens.stylex.ts";
import type { KINDS, StatusFilter } from "./kinds.ts";
import type { Filters } from "./useJobs.ts";

const styles = stylex.create({
  tools: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3, minWidth: 0 },
  search: { width: size.paletteButton, maxWidth: "100%" },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.s3 },
});

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "failed", label: "Failed" },
  { value: "done", label: "Done" },
  { value: "stopped", label: "Stopped" },
];

// ponytail: the filters in the head of the jobs pane (jobs.mjs toolbar): text, status, kind
export function JobsTools({
  filters,
  onFilters,
  count,
  present,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  count: (s: StatusFilter) => number;
  present: typeof KINDS;
}) {
  return (
    <div {...stylex.props(styles.tools)}>
      <span {...stylex.props(styles.search)}>
        <Text
          type="search"
          size="sm"
          icon="search"
          ariaLabel="Filter jobs"
          placeholder="Filter by job, document or test"
          value={filters.text}
          onChange={(text) => onFilters({ ...filters, text })}
        />
      </span>
      <Segmented<StatusFilter>
        label="Show jobs"
        size="sm"
        value={filters.status}
        onChange={(status) => onFilters({ ...filters, status })}
        options={STATUSES.map((s) => ({ ...s, count: count(s.value) }))}
      />
      <Select
        label="Kind"
        prefix="Kind"
        appearance="quiet"
        size="sm"
        disabled={present.length > 1 ? false : "Only one kind of job here"}
        value={filters.kind}
        onChange={(kind) => onFilters({ ...filters, kind })}
        options={[{ value: "all", label: "All kinds" }, ...present.map((t) => ({ value: t.id, label: t.label }))]}
      />
    </div>
  );
}

// ponytail: the buttons at the right end of the jobs pane's head
export function JobsActions({
  group,
  onGroup,
  finished,
  onClear,
}: {
  group: boolean;
  onGroup: (on: boolean) => void;
  finished: number;
  onClear: () => void;
}) {
  return (
    <div {...stylex.props(styles.actions)}>
      <Switch label="Group repeats" on={group} onChange={onGroup} />
      <Button variant="quiet" size="sm" icon="trash" label="Clear finished" disabled={!finished} onClick={onClear} />
    </div>
  );
}
