import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { plural } from "../../lib/format.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";

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
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
  },
});

// ponytail: the queue holds nothing — every test of the filter is reviewed, or none was generated yet
export function ReviewEmpty({
  validated,
  onGenerate,
  onTests,
}: {
  validated: number;
  onGenerate: () => void;
  onTests: () => void;
}) {
  return (
    <div {...stylex.props(styles.center)}>
      {validated > 0 ? (
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
        <div key={i} {...stylex.props(styles.card)}>
          <Skeleton kind="circle" />
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}
