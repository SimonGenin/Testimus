import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { StepLayout } from "../tests/StepCard.tsx";
import { marksLine, type RunResult, stepCounts } from "./runs.ts";
import { StepDots } from "./StepDots.tsx";

const styles = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3, paddingTop: space.s3 },
  title: { margin: 0 },
  line: { color: color.textMuted },
  grow: { flex: 1 },
});

// ponytail: the steps' head — how many, how they are marked, OK on every step left, the OK steps folded to one line,
// the layout the Tests editor uses (the same choice, remembered once)
export function RunStepsHead({
  result,
  layout,
  fold,
  onLayout,
  onFold,
  onRestOk,
}: {
  result: RunResult;
  layout: StepLayout;
  fold: boolean;
  onLayout: (l: StepLayout) => void;
  onFold: (on: boolean) => void;
  onRestOk: () => void;
}) {
  const left = stepCounts(result).left;
  return (
    <div {...stylex.props(styles.head)}>
      <h3 {...stylex.props(type.titleSm, styles.title)}>Steps</h3>
      <Badge label={String(result.steps.length)} count />
      <StepDots steps={result.steps} />
      <span {...stylex.props(type.compact, styles.line)}>{marksLine(result)}</span>
      <span {...stylex.props(styles.grow)} />
      <Button
        variant="quiet"
        size="sm"
        icon="check"
        label={left ? `Mark the ${left} left OK` : "Mark the rest OK"}
        disabled={left ? false : "Every step is marked"}
        onClick={onRestOk}
      />
      <Switch label="Fold OK steps" on={fold} onChange={onFold} />
      <Segmented<StepLayout>
        size="sm"
        label="Step layout"
        value={layout}
        onChange={onLayout}
        options={[
          { value: "stacked", label: "Stacked", icon: "layout-stacked" },
          { value: "split", label: "Action | Expected", icon: "layout-split" },
        ]}
      />
    </div>
  );
}
