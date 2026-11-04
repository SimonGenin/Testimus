import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { plural } from "../../lib/format.ts";
import { size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: space.s7 },
  col: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    width: "100%",
    maxWidth: `calc(${size.reading} + ${space.s11} * 2)`,
    marginInline: "auto",
    paddingTop: space.s6,
    paddingInline: space.s7,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
});

export type Narrowed = { onlyValidated: boolean; onClear?: () => void };

// ponytail: the queue's filters leave nothing — said the same way in the queue and in the main column
export function FilteredEmpty({ onlyValidated, onClear, compact }: Narrowed & { compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={onlyValidated ? "validated" : "filter"}
      title={onlyValidated ? "No generated test validated yet" : "No test matches these filters"}
      text={
        onlyValidated ? "A generated test stays readable here once validated, and also appears in Tests." : undefined
      }
      actions={onClear && <Button size="sm" label="Clear the filters" onClick={onClear} />}
    />
  );
}

// ponytail: the queue holds nothing — the filters leave nothing, every test is reviewed, or none was generated yet
export function ReviewEmpty({
  validated,
  narrowed,
  onGenerate,
  onTests,
}: {
  validated: number;
  /** the queue's filters are on: the same empty state as the queue's */
  narrowed?: Narrowed;
  onGenerate: () => void;
  onTests: () => void;
}) {
  return (
    <div {...stylex.props(styles.center)}>
      {narrowed ? (
        <FilteredEmpty {...narrowed} />
      ) : validated > 0 ? (
        <EmptyState
          icon="validated"
          title="All reviewed"
          text={`${plural(validated, "test")} validated. They are ready to push to Jira from the Tests screen.`}
          actions={<Button variant="primary" icon="tests" label="Open the tests" onClick={onTests} />}
        />
      ) : (
        <EmptyState
          icon="review"
          title="Nothing to review"
          text="Generated tests come here once written and checked. Once validated they stay readable here and appear in Tests."
          actions={<Button variant="primary" icon="generate" label="Generate tests" onClick={onGenerate} />}
        />
      )}
    </div>
  );
}

export function ReviewLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the test" {...stylex.props(styles.col)}>
      <Skeleton kind="title" width="70%" />
      <Skeleton width="40%" />
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <Skeleton kind="circle" />
          <Skeleton lines={3} />
        </Card>
      ))}
    </div>
  );
}
