import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { RunView } from "./runs.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3 },
  legend: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s5 },
  item: { display: "inline-flex", alignItems: "center", gap: space.s2, fontVariantNumeric: "tabular-nums" },
  muted: { color: color.textMuted },
});

// ponytail: how far the run is — one bar split by result, then each result with its count and the open questions
export function RunProgress({ run, questions }: { run: RunView; questions: number }) {
  const total = run.tests.length || 1;
  const share = (n: number) => (n / total) * 100;
  const c = run.counts;
  const played = run.tests.length - c.notRun;
  return (
    <div {...stylex.props(styles.wrap)}>
      <Progress
        label="Run progress"
        detail={`${played} of ${plural(run.tests.length, "test")} run`}
        segments={[
          { value: share(c.passed), tone: "success" },
          { value: share(c.problem), tone: "danger" },
          { value: share(c.blocked), tone: "warning" },
        ]}
      />
      <div {...stylex.props(type.small, styles.legend)}>
        {(
          [
            ["passed", c.passed],
            ["problem", c.problem],
            ["blocked", c.blocked],
            ["not-run", c.notRun],
          ] as const
        ).map(([s, n]) => (
          <span key={s} {...stylex.props(styles.item)}>
            <Badge {...RUN_STATUS[s]} size="sm" />
            {n}
          </span>
        ))}
        {questions > 0 && <span {...stylex.props(styles.muted)}>{plural(questions, "open question")}</span>}
      </div>
    </div>
  );
}
