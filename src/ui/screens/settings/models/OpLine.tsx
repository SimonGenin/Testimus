import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Progress } from "../../../components/ui/Progress.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { useCancel, useJob } from "../jobs.ts";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  line: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  bar: { display: "flex", flexDirection: "column", gap: space.s1, flex: 1, minWidth: 0 },
  word: { color: color.text },
});

// ponytail: a job's progress where its subject is (a pack card, a catalog row, under the folder), with Cancel — the
// icon alone where the room is short (a catalog row), its label then the tooltip
export function OpLine({
  op,
  cancellable = true,
  compact = false,
}: {
  op: Op;
  cancellable?: boolean;
  compact?: boolean;
}) {
  const cancel = useCancel();
  const { live } = useJob(op.jobId);
  return (
    <div role="status" aria-label={op.label} {...stylex.props(styles.line)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(type.small, styles.word)}>
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
          iconOnly={compact}
          label="Cancel"
          onClick={() => cancel(op.jobId)}
        />
      )}
    </div>
  );
}
