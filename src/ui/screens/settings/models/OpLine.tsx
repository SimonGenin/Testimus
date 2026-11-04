import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Progress } from "../../../components/ui/Progress.tsx";
import { color, fontSize, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import { useCancel, useJob } from "../jobs.ts";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  line: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  bar: { display: "flex", flexDirection: "column", gap: space.s1, flex: 1, minWidth: 0 },
  word: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.text },
});

// ponytail: a job's progress where its subject is (a pack card, a catalog row, under the folder), with Cancel
export function OpLine({ op, cancellable = true }: { op: Op; cancellable?: boolean }) {
  const cancel = useCancel();
  const { live } = useJob(op.jobId);
  return (
    <div role="status" aria-label={op.label} {...stylex.props(styles.line)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(styles.word)}>
          {op.label}
          {live.pct !== null ? ` · ${live.pct} %` : ""}
        </span>
        <Progress label={op.label} value={live.pct} detail={live.message} />
      </div>
      {cancellable && op.jobId && (
        <Button
          size="xs"
          variant="quiet"
          icon="stop"
          iconOnly
          label={`Cancel: ${op.label}`}
          onClick={() => cancel(op.jobId)}
        />
      )}
    </div>
  );
}
