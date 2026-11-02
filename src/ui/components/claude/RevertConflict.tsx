import { Button, Severity } from "../ui/index.ts";

export function RevertConflict({
  detail,
  onForce,
  onKeep,
}: {
  detail: string;
  onForce: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="find f-warn revert-conflict" role="alert">
      <Severity tone="warning">Edited after the Claude run</Severity>
      <p>{detail}</p>
      <p className="muted">
        Reverting anyway puts back the version from before Claude and drops those later edits too.
      </p>
      <div className="rstatus-actions">
        <Button size="sm" icon="revert" onClick={onForce}>
          Revert anyway
        </Button>
        <Button size="sm" tone="quiet" onClick={onKeep}>
          Keep the test as it is
        </Button>
      </div>
    </div>
  );
}
