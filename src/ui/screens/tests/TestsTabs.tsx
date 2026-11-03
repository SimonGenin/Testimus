import type { ReactNode } from "react";
import { Tabs } from "../../components/ui/index.ts";

export type ListTab = "local" | "jira";

export function TestsTabs({
  value,
  local,
  jira,
  onPick,
}: {
  value: ListTab;
  local?: number;
  jira?: ReactNode;
  onPick: (tab: ListTab) => void;
}) {
  const count = (n?: number) => n !== undefined && <span className="tab-count">{n}</span>;
  return (
    <Tabs
      label="Where"
      className="tside-tabs"
      value={value}
      onChange={onPick}
      options={[
        {
          value: "local",
          label: <>Local {count(local)}</>,
          title: "Tests written by hand, pulled, imported, or generated and validated",
        },
        { value: "jira", label: <>Jira {jira}</> },
      ]}
    />
  );
}
