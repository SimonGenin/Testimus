import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { column, layoutOf, section } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { RunFindings } from "./RunFindings.tsx";
import { RunList } from "./RunList.tsx";
import type { RunSummary, RunView } from "./runs.ts";

const styles = stylex.create({
  list: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingBlock: space.s4,
    paddingInline: space.s3,
  },
  none: { boxSizing: "border-box", flex: 1, display: "flex", padding: space.s7 },
});

// ponytail: the runs on the left, the run open in the middle, what it found and Claude on the right
const LAYOUT = layoutOf(
  column(300, section(["runs"])),
  column(null, section(["run"])),
  column(380, section(["found", "claude"])),
);

// ponytail: the runs page in sections — the list of runs, the run open (its progress, its tests: the screen says what
// shows there, a run, the first run, its loading or why it cannot be read), what the run found
export function RunOverview({
  runs,
  shown,
  overview,
  main,
  onOpen,
  onOpenTest,
  onAsk,
}: {
  runs: RunSummary[] | undefined;
  /** the run open */
  shown: string;
  overview: RunView | undefined;
  /** the run's tab body: its detail, its empty, loading or error state */
  main: ReactNode;
  onOpen: (slug: string) => void;
  onOpenTest: (testId: string) => void;
  onAsk: (prompt?: string) => void;
}) {
  const claude = useClaudeTab();
  const problems = overview ? overview.counts.problem + overview.counts.blocked : 0;
  const ws = useWorkspace({
    pref: "layoutRun",
    label: "Run",
    defaults: LAYOUT,
    tabs: [
      {
        id: "runs",
        label: "Runs",
        icon: "list",
        count: runs?.length,
        content: (
          <nav aria-label="Runs" {...stylex.props(styles.list)}>
            <RunList runs={runs} selected={shown} onOpen={onOpen} />
          </nav>
        ),
      },
      { id: "run", label: "Run", icon: "play", main: true, content: main },
      {
        id: "found",
        label: "What the run found",
        icon: "alert-triangle",
        ...(problems ? { count: problems } : {}),
        content: overview ? (
          <RunFindings run={overview} onOpenTest={onOpenTest} onAsk={onAsk} />
        ) : (
          <div {...stylex.props(styles.none)}>
            <EmptyState
              icon="alert-triangle"
              title="No run open"
              text="Open a run to see its problems, blocked tests and open questions."
            />
          </div>
        ),
      },
      claude,
    ],
  });
  return <Workspace ws={ws} />;
}
