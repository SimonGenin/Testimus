import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import { space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  tools: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingInline: space.s3,
    paddingBottom: space.s2,
  },
  row: { display: "flex", alignItems: "center", gap: space.s1 },
  grow: { flex: 1 },
});

// the two boxes and the tools above the list, as in Xray Editor: « Search Jira » asks Jira, « Filter tests » narrows
// what is listed (Enter sends it to Jira as a search); New test, Clone, Pull, Show in Explorer
export function ListTools({
  jira,
  local,
  search,
  filter,
  newFolder,
  canClone,
  pullBusy,
  canReveal,
  reveal,
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
  canClone: boolean;
  pullBusy: boolean;
  canReveal: boolean;
  /** the desktop window is there to reveal a file */
  reveal: boolean;
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
          size="sm"
          icon="search"
          ariaLabel="Search Jira"
          placeholder="Search Jira — words or an issue key"
          value={search}
          onChange={onSearch}
        />
      )}
      <Text
        size="sm"
        icon="filter"
        ariaLabel="Filter tests"
        placeholder={local ? "Filter tests: words, steps, review:to-fix…" : "Filter folders and listed tests"}
        value={filter}
        onChange={onFilter}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onFilterEnter();
          }
        }}
      />
      <div {...stylex.props(styles.row)}>
        <Tooltip label={`New local test in ${newFolder}`}>
          <Button size="sm" icon="plus" label="New test" onClick={onNew} />
        </Tooltip>
        <Button
          size="sm"
          variant="quiet"
          iconOnly
          icon="copy"
          label="Clone"
          disabled={canClone ? false : "Open a test to clone it"}
          onClick={onClone}
        />
        {jira && (
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="download"
            label="Pull"
            disabled={pullBusy}
            onClick={onPull}
          />
        )}
        <span {...stylex.props(styles.grow)} />
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
