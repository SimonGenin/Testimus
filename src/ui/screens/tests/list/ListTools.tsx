import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Segmented } from "../../../components/ui/Segmented.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import { border, color, space } from "../../../styles/tokens.stylex.ts";
import type { JiraLayout } from "../JiraTab.tsx";

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
  row: { display: "flex", alignItems: "center", gap: space.s1 },
  grow: { flex: 1 },
});

// the two boxes and the tools above the list, as in Xray Editor: « Search Jira » asks Jira, « Filter tests » narrows
// what is listed (Enter sends it to Jira as a search); New test, Clone, Pull, Jira's layout, Show in Explorer
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
  onLayout,
  noProject = false,
  jiraOff = false,
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
  /** Jira's folders and tests side by side or one above the other — no switch when undefined */
  layout?: JiraLayout;
  onLayout?: (layout: JiraLayout) => void;
  /** no project is open: nothing to filter, nowhere to create */
  noProject?: boolean;
  /** the Jira tab of a project not connected to Jira: its search and Pull wait for the connection */
  jiraOff?: boolean;
  onSearch: (v: string) => void;
  onFilter: (v: string) => void;
  onFilterEnter: () => void;
  onNew: () => void;
  onClone: () => void;
  onPull: () => void;
  onReveal: () => void;
}) {
  return (
    <div {...stylex.props(styles.tools)}>
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
      <div {...stylex.props(styles.row)}>
        {noProject ? (
          <Button size="sm" icon="plus" label="New test" disabled="Open a project first" onClick={onNew} />
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
        <span {...stylex.props(styles.grow)} />
        {layout && onLayout && (
          <Segmented<JiraLayout>
            size="sm"
            label="Folders and tests"
            value={layout}
            onChange={onLayout}
            options={[
              { value: "columns", label: "Side by side", icon: "layout-split", iconOnly: true },
              { value: "rows", label: "One above the other", icon: "layout-stacked", iconOnly: true },
            ]}
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
      </div>
    </div>
  );
}
