import type { ReactNode } from "react";
import { Tabs } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";

export type ListTab = "local" | "jira";

// ponytail: the Review tab is its own screen; its Jira tab opens the list there once (read on mount, then cleared)
let asked: ListTab = "local";
export const askedTab = () => asked;
export const clearAskedTab = () => {
  asked = "local";
};

export function TestsTabs({
  value,
  local,
  review,
  jira,
  onPick,
}: {
  value: ListTab | "review";
  local?: number;
  review?: number;
  jira?: ReactNode;
  onPick?: (tab: ListTab) => void;
}) {
  const app = useApp();
  const pick = (t: ListTab | "review") => {
    if (t === "review") return app.navigate("review");
    if (onPick) return onPick(t);
    asked = t;
    app.navigate("tests");
  };
  const count = (n?: number) => n !== undefined && <span className="tab-count">{n}</span>;
  return (
    <Tabs
      label="Where"
      className="tside-tabs"
      value={value}
      onChange={pick}
      options={[
        {
          value: "local",
          label: <>Local {count(local)}</>,
          title: "Tests written by hand, pulled, imported, or generated and validated",
        },
        { value: "review", label: <>Review {count(review)}</>, title: "Generated tests waiting for a reviewer" },
        { value: "jira", label: <>Jira {jira}</> },
      ]}
    />
  );
}
