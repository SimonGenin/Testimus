import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { breakpoint, color, space } from "../../styles/tokens.stylex.ts";
import { inProgress, type RunStatus, type RunView } from "./runs.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s4 },
  top: { display: "flex", alignItems: "baseline", gap: space.s3, flexWrap: "wrap" },
  big: { margin: 0 },
  muted: { color: color.textMuted },
  grow: { flex: 1 },
  tiles: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      [breakpoint.sm]: "repeat(2, minmax(0, 1fr))",
    },
    gap: space.s4,
  },
  tile: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1 },
  n: { margin: 0 },
  sub: { color: color.textSubtle },
});

// ponytail: how far the run is — the count of tests with a result and one bar split by result, then a tile per
// result: its count and what stands out (the tests a NOK proposes Problem on, the reason of a blocked one)
export function RunStats({ run }: { run: RunView }) {
  const c = run.counts;
  const total = run.tests.length;
  const done = total - c.notRun;
  const share = (n: number) => (n / (total || 1)) * 100;
  const pct = Math.round(share(done));
  const proposedProblems = run.tests.filter((t) => t.result.proposed === "problem").length;
  const playing = run.tests.filter(inProgress).length;
  const blocked = run.tests.find((t) => t.result.status === "blocked");
  const questions = run.tests.reduce((n, t) => n + t.result.openQuestions, 0);
  const sub: Record<RunStatus, string> = {
    passed: `${Math.round(share(c.passed))} % of the run`,
    problem: proposedProblems ? `${plural(proposedProblems, "more")} NOK under another result` : "No other NOK",
    blocked: blocked?.result.blockedReason ? `« ${blocked.result.blockedReason} »` : "Nothing blocked",
    "not-run": playing ? `${playing} in progress` : questions ? plural(questions, "open question") : "None left",
  };
  return (
    <div {...stylex.props(styles.wrap)}>
      <Card>
        <div {...stylex.props(styles.wrap)}>
          <div {...stylex.props(styles.top)}>
            <span {...stylex.props(type.display, type.tabular, styles.big)}>{done}</span>
            <span {...stylex.props(styles.muted)}>of {plural(total, "test")} have a result</span>
            <span {...stylex.props(styles.grow)} />
            {questions > 0 && <Badge label={plural(questions, "open question")} tone="info" icon="info" />}
            <span {...stylex.props(type.title, type.tabular, styles.muted)}>{pct} %</span>
          </div>
          <Progress
            label="Run progress"
            detail={`${done} of ${plural(total, "test")} run`}
            segments={[
              { value: share(c.passed), tone: "success" },
              { value: share(c.problem), tone: "danger" },
              { value: share(c.blocked), tone: "warning" },
            ]}
          />
        </div>
      </Card>
      <div {...stylex.props(styles.tiles)}>
        {(
          [
            ["passed", c.passed],
            ["problem", c.problem],
            ["blocked", c.blocked],
            ["not-run", c.notRun],
          ] as const
        ).map(([s, n]) => (
          <Card key={s} density="compact" label={RUN_STATUS[s].label}>
            <div {...stylex.props(styles.tile)}>
              <Badge {...RUN_STATUS[s]} />
              <span {...stylex.props(type.titleLg, type.tabular, styles.n)}>{n}</span>
              <span title={sub[s]} {...stylex.props(type.small, styles.sub)}>
                {sub[s]}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
