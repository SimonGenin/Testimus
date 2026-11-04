import { Tabs } from "../../components/ui/Tabs.tsx";

export type ListTab = "local" | "jira";

// the two sides of the test list: the project's own tests, and Jira's (its count once the tree is read)
export function TestsTabs({
  value,
  local,
  jira,
  jiraOff,
  onPick,
}: {
  value: ListTab;
  local?: number;
  jira?: number;
  /** the project works locally: the tab says Jira is off */
  jiraOff?: boolean;
  onPick: (tab: ListTab) => void;
}) {
  return (
    <Tabs<ListTab>
      label="Where"
      size="sm"
      value={value}
      onChange={onPick}
      tabs={[
        { value: "local", label: "Local", count: local },
        { value: "jira", label: jiraOff ? "Jira off" : "Jira", count: jira },
      ]}
    />
  );
}
