import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";
import type { PanesLayout } from "../../../components/tree/FolderPanes.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../../components/ui/Menu.tsx";
import { Segmented, type SegmentedOption } from "../../../components/ui/Segmented.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import { border, color, space } from "../../../styles/tokens.stylex.ts";
import { type Assignees, assigneesIn, toggleAssignee } from "./assignee.ts";

// ponytail: who the local tests are assigned to, as a menu of ticks that write assignee: words in the filter box
function AssigneeFilter({
  filter,
  who,
  short,
  onFilter,
}: {
  filter: string;
  who: Assignees;
  /** a tight row: « Assignee 2 » instead of the names (the filter box above shows them) */
  short: boolean;
  onFilter: (v: string) => void;
}) {
  const on = assigneesIn(filter).map((x) => x.toLowerCase());
  const tick = (value: string, label: string, hint?: string) => ({
    label,
    hint,
    checked: on.includes(value.toLowerCase()),
    keepOpen: true,
    onSelect: () => onFilter(toggleAssignee(filter, value)),
  });
  const entries: MenuEntry[] = [
    tick("me", "Me"),
    tick("none", "Unassigned", String(who.unassigned)),
    ...(who.people.length
      ? [{ group: "People" }, ...who.people.map((p) => tick(p.name, p.name, String(p.count)))]
      : []),
    "separator",
    { note: "Same as typing assignee:me, assignee:none or assignee:<name> in the filter." },
  ];
  return (
    <Menu
      label="Filter by assignee"
      trigger={
        <Button
          size="sm"
          variant={on.length ? "secondary" : "quiet"}
          iconAfter="chevron-down"
          label={on.length && !short ? `Assignee: ${assigneesIn(filter).join(", ")}` : "Assignee"}
          count={on.length && short ? on.length : undefined}
          pressed={on.length > 0}
          data-testid="assignee-filter"
        />
      }
      entries={entries}
    />
  );
}

export type ListLayout = PanesLayout | "tree";

// 1: the assignee count instead of the names · 2: New test as its icon too — past that the row wraps
const FOLDS = 2;

const LAYOUTS: SegmentedOption<ListLayout>[] = [
  { value: "tree", label: "One tree", icon: "tree", iconOnly: true },
  { value: "columns", label: "Side by side", icon: "layout-split", iconOnly: true },
  { value: "rows", label: "One above the other", icon: "layout-stacked", iconOnly: true },
];

const styles = stylex.create({
  tools: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingInline: space.s3,
    paddingTop: space.s3,
    paddingBottom: space.s3,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  row: { display: "flex", flexWrap: "nowrap", alignItems: "center", gap: space.s1, minWidth: "max-content" },
  wrap: { flexWrap: "wrap", minWidth: 0 },
  end: { display: "flex", alignItems: "center", gap: space.s1, marginInlineStart: "auto" },
});

// the two boxes and the tools above the list, as in Xray Editor: « Search Jira » asks Jira, « Filter tests » narrows
// what is listed (Enter sends it to Jira as a search); New test, Clone, Pull, the list's layout, Show in Explorer
export function ListTools({
  jira,
  local,
  search,
  filter,
  newFolder,
  canClone,
  pullBusy,
  pullLock = false,
  canReveal,
  reveal,
  layout,
  withTree = false,
  onLayout,
  noProject = false,
  jiraOff = false,
  assignees,
  onSearch,
  onFilter,
  onFilterEnter,
  onNew,
  onClone,
  onPull,
  onReveal,
}: {
  jira: boolean;
  local: boolean;
  search: string;
  filter: string;
  /** where New test puts the test: the Jira folder picked, else the open test's folder */
  newFolder: string;
  /** false when Clone can go, else why not (no test open, Claude on it) */
  canClone: false | string;
  pullBusy: boolean;
  /** Claude's lock on the open test: Pull waits */
  pullLock?: false | string;
  canReveal: boolean;
  /** the desktop window is there to reveal a file */
  reveal: boolean;
  /** the folders and tests side by side, one above the other, or (local only) one tree — no switch when undefined */
  layout?: ListLayout;
  /** the switch offers the one tree too (the local tests) */
  withTree?: boolean;
  onLayout?: (layout: ListLayout) => void;
  /** no project is open: nothing to filter, nowhere to create */
  noProject?: boolean;
  /** the Jira tab of a project not connected to Jira: its search and Pull wait for the connection */
  jiraOff?: boolean;
  /** the local tests' assignees: an « Assignee » filter beside the box (absent: none) */
  assignees?: Assignees;
  onSearch: (v: string) => void;
  onFilter: (v: string) => void;
  onFilterEnter: () => void;
  onNew: () => void;
  onClone: () => void;
  onPull: () => void;
  onReveal: () => void;
}) {
  // ponytail: the tools row stays one line as long as it can — too narrow, the assignee names give way to their
  // count, then New test to its icon; only then does the row wrap. The width each step needed is kept, so the words
  // come back once there is that room again. Unfolded, the row keeps its natural width (a button would rather shrink
  // than overflow), so it is measured against the room inside the box. Measured before paint: no frame of a crushed row.
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const need = useRef<number[]>([]);
  const [fold, setFold] = useState(0);
  const fit = useRef(() => {});
  fit.current = () => {
    const outer = box.current;
    const el = row.current;
    if (!outer || !el) return;
    const css = getComputedStyle(outer);
    const room = outer.clientWidth - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight);
    if (fold < FOLDS && el.offsetWidth > room + 0.5) {
      need.current[fold] = el.offsetWidth;
      setFold(fold + 1);
    } else if (fold > 0 && room >= need.current[fold - 1]) setFold(fold - 1);
  };
  useLayoutEffect(() => fit.current());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => fit.current());
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={box} {...stylex.props(styles.tools)}>
      {jira && (
        <Text
          type="search"
          icon="search"
          ariaLabel="Search Jira"
          placeholder="Search Jira — words or an issue key"
          value={search}
          disabled={jiraOff}
          onChange={onSearch}
        />
      )}
      <Text
        icon="filter"
        ariaLabel="Filter tests"
        placeholder={local ? "Filter tests: words, steps, review:to-fix…" : "Filter folders and listed tests"}
        type="search"
        value={filter}
        disabled={noProject}
        onChange={onFilter}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onFilterEnter();
          }
        }}
      />
      <div ref={row} {...stylex.props(styles.row, fold >= FOLDS && styles.wrap)}>
        {noProject ? (
          <Button
            size="sm"
            icon="plus"
            label="New test"
            iconOnly={fold >= 2}
            disabled="Open a project first"
            onClick={onNew}
          />
        ) : fold >= 2 ? (
          <Button size="sm" icon="plus" label={`New test in ${newFolder}`} iconOnly onClick={onNew} />
        ) : (
          <Tooltip label={`New test in ${newFolder}`}>
            <Button size="sm" icon="plus" label="New test" onClick={onNew} />
          </Tooltip>
        )}
        <Button
          size="sm"
          variant="quiet"
          iconOnly
          icon="copy"
          label="Clone"
          disabled={noProject ? "Open a project first" : canClone}
          onClick={onClone}
        />
        {jira && (
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="download"
            label="Pull"
            disabled={jiraOff ? "Connect the project to Jira first" : pullLock || pullBusy}
            onClick={onPull}
          />
        )}
        {local && assignees && !noProject && (
          <AssigneeFilter filter={filter} who={assignees} short={fold >= 1} onFilter={onFilter} />
        )}
        <span {...stylex.props(styles.end)}>
          {layout && onLayout && (
            <Segmented<ListLayout>
              size="sm"
              label="Folders and tests"
              value={layout}
              onChange={onLayout}
              options={LAYOUTS.filter((o) => withTree || o.value !== "tree")}
            />
          )}
          {reveal && (
            <Button
              size="sm"
              variant="quiet"
              iconOnly
              icon="folder-open"
              label="Show the test in Explorer"
              disabled={!canReveal}
              onClick={onReveal}
            />
          )}
        </span>
      </div>
    </div>
  );
}
