import { Badge } from "../../../components/ui/Badge.tsx";

// whose earlier version a step shows: Jira's at the last sync, or the test's before the Claude run that changed it
export type WasFrom = "jira" | "claude";
export const WAS = {
  jira: { title: "In Jira, last synced", aria: "as Jira has it", show: "Jira version", hide: "Hide Jira version" },
  claude: {
    title: "Before Claude's run",
    aria: "before Claude's run",
    show: "Before Claude",
    hide: "Hide before Claude",
  },
} as const;

// the toggle of an earlier version, in a step's head
export function WasToggle({ from, open, onToggle }: { from: WasFrom; open: boolean; onToggle: () => void }) {
  return (
    <Badge
      tone={from === "claude" ? "claude" : "warning"}
      icon="history"
      label={open ? WAS[from].hide : WAS[from].show}
      pressed={open}
      onClick={onToggle}
    />
  );
}
