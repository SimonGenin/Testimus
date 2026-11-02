import { Badge, Button } from "../../components/ui/index.ts";
import type { Pull } from "./pulls.ts";

export function PullPane({
  pull,
  others,
  onCancel,
  onRetry,
  onBack,
}: {
  pull: Pull;
  others: Pull[];
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  if (pull.error)
    return (
      <div className="editor-empty pullpane">
        <Badge tone="err" icon="error">
          Pull failed
        </Badge>
        <h2 className="h">
          Could not pull <span className="mono">{pull.key}</span>
        </h2>
        <p className="pullpane-error">{pull.error}</p>
        <div className="pullpane-row">
          <Button tone="primary" onClick={onRetry}>
            Retry
          </Button>
          <Button onClick={onBack}>Back</Button>
        </div>
      </div>
    );
  // ponytail: a pull that has not reported yet is either still reaching Jira or queued behind the
  // others the core is already working on
  const line = pull.message ?? (others.some((p) => p.message) ? "waiting for a free slot…" : "contacting Jira…");
  return (
    <div className="editor-empty pullpane" aria-busy="true">
      <div className="pullpane-head">
        <span className="spin" aria-hidden="true" />
        <h2 className="h">
          Pulling <span className="mono">{pull.key}</span>
        </h2>
      </div>
      {pull.summary && <p>{pull.summary}</p>}
      <div className="pullpane-progress mono" role="status">
        {line}
      </div>
      <Button onClick={onCancel}>Cancel</Button>
      {others.length > 0 && <p className="muted pullpane-hint">{others.length} more pulling in the background</p>}
    </div>
  );
}
