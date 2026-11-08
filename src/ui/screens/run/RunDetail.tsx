import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { RunStats } from "./RunStats.tsx";
import { RunTable } from "./RunTable.tsx";
import { day, nextNotRun, type RunView, type TestView } from "./runs.ts";

const styles = stylex.create({
  detail: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: color.canvas,
  },
  page: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "77.5rem",
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: space.s7,
    paddingBottom: space.s10,
    paddingInline: space.s7,
  },
  head: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: space.s4 },
  titles: { flex: "1 1 24rem", minWidth: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  title: { margin: 0 },
  muted: { color: color.textMuted },
  facts: { display: "flex", flexWrap: "wrap", gap: space.s5, color: color.textMuted },
  fact: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  strong: { color: color.text },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  explain: { margin: 0, maxWidth: size.reading, color: color.textSubtle },
});

const STATE = {
  open: { label: "In progress", tone: "accent", icon: "circle-dot" },
  done: { label: "Finished", tone: "success", icon: "check-circle" },
} as const;

// ponytail: one run — its facts (version, place, how many tests, its folder), how far it is (a bar and a tile per
// result), its tests with their results; Continue opens the next test not run yet
export function RunDetail({
  run,
  view,
  onView,
  onOpenTest,
  actions,
  me,
}: {
  me: string;
  run: RunView;
  view: TestView;
  onView: (v: TestView) => void;
  onOpenTest: (testId: string) => void;
  actions?: ReactNode;
}) {
  const next = nextNotRun(run.tests);
  const at = next ? run.tests.indexOf(next) + 1 : 0;
  const last = run.tests
    .map((t) => t.result)
    .filter((r) => r.updatedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  const started = [
    `Started ${day(run.createdAt)} by ${run.createdBy}`,
    run.importedAt && `results imported ${day(run.importedAt)}`,
    last && `last result ${day(last.updatedAt)} by ${last.updatedBy}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section aria-label={`Run ${run.name}`} {...stylex.props(styles.detail)}>
      <div {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.titles)}>
            <div {...stylex.props(styles.row)}>
              <Badge {...(next ? STATE.open : STATE.done)} />
              <span {...stylex.props(type.small, styles.muted)}>{started}</span>
            </div>
            <h2 {...stylex.props(type.titleLg, styles.title)}>{run.name}</h2>
            <div {...stylex.props(type.compact, styles.facts)}>
              {run.version && (
                <span {...stylex.props(styles.fact)}>
                  <Icon name="tag" size="sm" />
                  Version <span {...stylex.props(type.medium, styles.strong)}>{run.version}</span>
                </span>
              )}
              {run.environment && (
                <span {...stylex.props(styles.fact)}>
                  <Icon name="monitor" size="sm" />
                  <span {...stylex.props(type.medium, styles.strong)}>{run.environment}</span>
                </span>
              )}
              <span {...stylex.props(styles.fact)}>
                <Icon name="tests" size="sm" />
                {plural(run.tests.length, "frozen test")}
              </span>
              <span {...stylex.props(styles.fact)}>
                <Icon name="folder" size="sm" />
                <span {...stylex.props(type.mono)}>test-runs/{run.slug}/</span>
              </span>
            </div>
          </div>
          <div {...stylex.props(styles.actions)}>
            {actions}
            <Button
              variant="primary"
              icon="play"
              label={next ? `Continue · test ${at}` : "Every test has a result"}
              disabled={!next}
              onClick={() => next && onOpenTest(next.id)}
            />
          </div>
        </div>
        <RunStats run={run} />
        <RunTable run={run} view={view} onView={onView} onOpenTest={onOpenTest} me={me} />
        <p {...stylex.props(type.small, styles.explain)}>
          A run is a frozen copy of its tests as they were when it was made: a test edited later does not change what is
          run. It is a folder of the project (test-runs/), shared like the tests; Claude reads it, never marks a result.
        </p>
      </div>
    </section>
  );
}
