import type { ChatProblem } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { Button } from "../ui/Button.tsx";
import { useClaudeStatus } from "./useClaudeStatus.ts";

// ponytail: « Ask Claude » beside a problem the app met — it writes the problem in the dock and asks Claude about it;
// Claude explains the cause and the steps, and leaves an action card when the app's own commands can fix it. Nothing
// is proposed before Claude has looked: that is the difference with a Claude action
export function AskAbout({
  problem,
  label,
  size = "sm",
}: {
  problem: ChatProblem;
  /** how the question is named in the dock (the check, the job…) */
  label?: string;
  size?: "sm" | "md";
}) {
  const app = useApp();
  const { status } = useClaudeStatus();
  const offline = !!status && (!status.installed || status.signedIn === false);
  const why = !app.info
    ? "Open a project to ask Claude"
    : offline
      ? "Claude is not connected"
      : app.claudeRunning
        ? "Claude is working — wait for it to finish"
        : false;
  return (
    <Button
      variant="claude"
      size={size}
      icon="claude"
      label="Ask Claude"
      disabled={why}
      onClick={() => app.askAbout(problem, label)}
    />
  );
}
