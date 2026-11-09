import { useCallback, useState } from "react";
import type { ChatProblem } from "../../core/types.ts";
import type { DockJob, DockRequest } from "../components/claude/ClaudeDock.tsx";
import { CLAUDE_TAB } from "../components/claude/ClaudeTab.tsx";
import { askReveal } from "../lib/workspace/signals.ts";

// ponytail: Claude is a tab of every screen's sections — a request from a screen (Ask Claude, a run, a question)
// reaches the one dock the shell keeps and shows its tab; Ctrl J shows it, or folds it when it is the one shown
export function useDock() {
  const [request, setRequest] = useState<DockRequest | null>(null);

  const toggle = useCallback(() => askReveal(CLAUDE_TAB, true), []);

  const open = useCallback((r: Omit<DockRequest, "nonce">) => {
    setRequest({ ...r, nonce: Date.now() } as DockRequest);
    askReveal(CLAUDE_TAB);
  }, []);

  const askClaude = useCallback(
    (scope: "test" | "step" | "run", prompt?: string) => open({ mode: "test", scope, prompt }),
    [open],
  );
  const runInDock = useCallback((job: DockJob) => open({ mode: "test", job }), [open]);
  const askDocs = useCallback(
    (prompt?: string, send?: boolean) => open({ mode: "docs", prompt, ...(send ? { send } : {}) }),
    [open],
  );
  const askAbout = useCallback(
    (problem: ChatProblem, label?: string) => open({ mode: "docs", problem, ...(label ? { label } : {}) }),
    [open],
  );

  return { request, toggle, askClaude, runInDock, askDocs, askAbout };
}
