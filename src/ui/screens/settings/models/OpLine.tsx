import { IconButton } from "../../../components/ui/index.ts";
import type { Op } from "./data.ts";

export function OpLine({ op, onCancel }: { op: Op; onCancel?: (jobId: string) => void }) {
  return (
    <div className="opline" role="status" aria-label={op.label}>
      <span className="sev s-run">
        <span className="dot run-dot" />
        {op.label}
        {op.pct !== null ? ` · ${op.pct} %` : ""}
      </span>
      <div className="prog" aria-hidden="true">
        <span style={{ width: `${op.pct ?? 0}%` }} />
      </div>
      <span className="muted opline-msg">{op.message}</span>
      {onCancel && op.jobId && (
        <IconButton icon="stop" label={`Cancel: ${op.label}`} onClick={() => onCancel(op.jobId)} />
      )}
    </div>
  );
}
