import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatProblem } from "../../core/types.ts";
import type { DockJob, DockRequest } from "../components/claude/ClaudeDock.tsx";
import type { Screen } from "../lib/app.ts";

// ponytail: the Claude dock — folded to its strip at start; Review needs its three columns, so the dock folds there
// and comes back as the user left it after; a request from a screen (Ask Claude, a run, a question) opens it
export function useDock(screen: Screen) {
  const [folded, setFolded] = useState(true);
  const [request, setRequest] = useState<DockRequest | null>(null);
  const userFold = useRef<boolean | null>(null);

  const toggle = useCallback(() => {
    setFolded((f) => {
      userFold.current = !f;
      return !f;
    });
  }, []);

  const open = useCallback((r: Omit<DockRequest, "nonce">) => {
    userFold.current = false;
    setFolded(false);
    setRequest({ ...r, nonce: Date.now() } as DockRequest);
  }, []);

  const askClaude = useCallback(
    (scope: "test" | "step", prompt?: string) => open({ mode: "test", scope, prompt }),
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

  const last = useRef<Screen | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = screen;
    if (screen === "review" && was !== "review") setFolded(true);
    else if (was === "review" && screen !== "review") setFolded(userFold.current ?? true);
  }, [screen]);

  return { folded, request, toggle, askClaude, runInDock, askDocs, askAbout };
}
