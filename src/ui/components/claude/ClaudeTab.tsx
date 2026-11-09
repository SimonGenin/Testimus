import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { ActionTarget } from "../../../core/types.ts";
import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import type { WorkspaceTab } from "../../lib/workspace/useWorkspace.ts";
import { useDockState } from "./dockState.ts";
import { docOfRoute } from "./turns.ts";

export const CLAUDE_TAB = "claude";

/** the element the shell keeps its one Claude dock in: a screen's Claude tab takes it in while it shows */
export const ClaudeHolder = createContext<HTMLElement | null>(null);

const styles = stylex.create({
  slot: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
});

// ponytail: the shell draws one dock for the whole app (its conversation and its runs survive a change of screen);
// the Claude tab of the screen shown moves that dock's element in, and the next screen's tab takes it from there
export function ClaudeSlot() {
  const holder = useContext(ClaudeHolder);
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el || !holder) return;
    el.appendChild(holder);
    return () => {
      if (holder.parentNode === el) el.removeChild(holder);
    };
  }, [holder]);
  return <div ref={slot} {...stylex.props(styles.slot)} />;
}

/** Claude's tab, the same in every screen: its count is the actions Claude proposes here (the dock's own read), its
 * dot what the dock says — a run under way (violet), the last one failed or no Claude to talk to (red) */
export function useClaudeTab(): WorkspaceTab {
  const app = useApp();
  const dock = useDockState();
  const docId = docOfRoute(app.route);
  const focus = app.focus;
  const view: ActionTarget | undefined =
    focus && !focus.run ? { kind: "test", id: focus.testId } : docId ? { kind: "document", id: docId } : undefined;
  const read = useRead("actions.list", view ? { view } : {}, { enabled: !!project() });
  const open = ((read.data as unknown as Action[] | undefined) ?? []).filter((a) => a.state === "open").length;
  return {
    id: CLAUDE_TAB,
    label: "Claude",
    icon: "claude",
    claude: true,
    ...(open ? { count: open } : {}),
    ...(app.claudeRunning || dock.running
      ? { dot: "claude" as const }
      : dock.failed || dock.offline
        ? { dot: "danger" as const }
        : {}),
    content: <ClaudeSlot />,
  };
}
