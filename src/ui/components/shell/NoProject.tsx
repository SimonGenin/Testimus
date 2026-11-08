import { SETUP_FROM_APP, useApp } from "../../lib/app.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";

// ponytail: the one empty state of a screen that needs a project — what the screen would hold, and « Open a project… »
// to Setup's project step, where a folder is opened or a new project made
export function NoProject({ text, compact = false }: { text: string; compact?: boolean }) {
  const app = useApp();
  return (
    <EmptyState
      icon="folder"
      title="No project open"
      text={text}
      compact={compact}
      actions={
        <Button
          variant="primary"
          icon="folder-open"
          label="Open a project…"
          onClick={() => app.navigate("setup", SETUP_FROM_APP)}
        />
      }
    />
  );
}
