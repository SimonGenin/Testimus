import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS, SYNC } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { inProgress, type RunStatus, type RunTestView } from "./runs.ts";

const styles = stylex.create({
  head: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  title: { margin: 0, overflowWrap: "anywhere" },
  chips: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  proposed: { display: "inline-flex", alignItems: "center", gap: space.s1, color: color.textMuted },
  desc: { margin: 0, maxWidth: size.reading, color: color.textMuted, whiteSpace: "pre-wrap" },
});

const IN_PROGRESS = { label: "In progress", tone: "accent", icon: "circle-dot" } as const;

// ponytail: the test as the run froze it — its summary, where its result stands (the one the marks propose beside a
// test not run yet), where it comes from, what it checks
export function RunHead({ test, proposed }: { test: RunTestView; proposed: RunStatus | null }) {
  const r = test.result;
  const word = inProgress(test) ? IN_PROGRESS : RUN_STATUS[r.status];
  return (
    <Card>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(type.title, styles.title)}>{test.summary}</h2>
        <div {...stylex.props(styles.chips)}>
          <Badge {...word} />
          {proposed && proposed !== r.status && (
            <span {...stylex.props(type.small, styles.proposed)}>
              <Icon name="arrow-right" size="sm" />
              <Badge {...RUN_STATUS[proposed]} outline />
              by the marks
            </span>
          )}
          {test.key ? <Badge label={test.key} icon="external" outline /> : <Badge {...SYNC.local} outline />}
          {test.preconditions.length > 0 && (
            <Badge label={`Precondition ${test.preconditions.join(", ")}`} icon="lock" outline />
          )}
        </div>
        {test.description && <p {...stylex.props(type.compact, styles.desc)}>{test.description}</p>}
      </div>
    </Card>
  );
}
