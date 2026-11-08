import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { space } from "../../../styles/tokens.stylex.ts";
import { useJob } from "../jobs.ts";
import type { PackRow } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  foot: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap", width: "100%" },
});

// ponytail: Measure, Measure again, or the measure's progress while it runs (a click opens it)
function MeasureButton({
  jobId,
  again,
  disabled,
  onClick,
}: {
  jobId: string | null;
  again: boolean;
  disabled: boolean | string;
  onClick: () => void;
}) {
  const { live } = useJob(jobId);
  let label = again ? "Measure again" : "Measure";
  if (jobId !== null) label = live.pct !== null ? `Measuring · ${live.pct} %` : "Measuring…";
  return <Button size="sm" variant="quiet" icon="target" label={label} disabled={disabled} onClick={onClick} />;
}

// The foot of a pack card in Settings › Models: the job on the pack while it runs, else « Use this pack » (not for the
// pack this PC chose with its models here — a pack in use as a fallback, Light while Quality is missing, can still be
// chosen) and the measure
export function PackActions({
  pack,
  op,
  measure,
  busy,
  onUse,
  onMeasure,
}: {
  pack: PackRow;
  op: Op | null;
  measure?: Op | null;
  busy: boolean;
  onUse: () => void;
  onMeasure?: () => void;
}) {
  const ready = pack.available && pack.installed === "all";
  if (op)
    return (
      <div {...stylex.props(styles.foot)}>
        <OpLine op={op} />
      </div>
    );
  return (
    <div {...stylex.props(styles.foot)}>
      {!(pack.chosen && ready) && (
        <Button size="sm" label="Use this pack" disabled={!pack.available || busy} onClick={onUse} />
      )}
      {onMeasure && (
        <MeasureButton
          jobId={measure?.jobId ?? null}
          again={pack.measuredHere}
          disabled={!ready ? "Install the pack's models first (Use this pack)" : busy && !measure}
          onClick={onMeasure}
        />
      )}
    </div>
  );
}
