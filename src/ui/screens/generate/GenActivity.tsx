import * as stylex from "@stylexjs/stylex";
import { askedOf, ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { useNow } from "../../components/claude/useNow.ts";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { useApp } from "../../lib/app.ts";
import { space } from "../../styles/tokens.stylex.ts";
import type { Generation } from "./useGeneration.ts";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    paddingBlockStart: space.s6,
    paddingBlockEnd: space.s9,
    paddingInline: space.s7,
  },
});

// ponytail: Generate's « Claude's work » tab — the run followed by the screen, phase by phase, beside the tests it
// writes rather than folded under them
export function GenActivity({ gen }: { gen: Generation }) {
  const app = useApp();
  const now = useNow(gen.running, 1000);
  const asked = askedOf(gen.job, app.info?.project.claude);
  return (
    <div {...stylex.props(styles.pane)}>
      {gen.jobId ? (
        <ClaudeActivity
          frame="tab"
          events={gen.events}
          running={gen.running}
          now={now}
          model={asked.model}
          effort={asked.effort}
        />
      ) : (
        <EmptyState
          wide
          icon="claude"
          title="Claude's work shows here"
          text="Once a generation starts: what it searched and read, its plan, the tests it wrote and the check's verdicts."
        />
      )}
    </div>
  );
}
