import { useState } from "react";
import type { CredsStatus } from "../../../core/types.ts";
import { Button, Icon } from "../../components/ui/index.ts";
import { ConnectAtlassian } from "../settings/ConnectAtlassian.tsx";

export function AccessStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<CredsStatus | null>(null);
  const [okAll, setOkAll] = useState(false);
  const found = !!status?.jira.complete && !!status?.xray.complete;
  return (
    <div className="setup-form">
      <h1 className="h setup-title">Connect to Jira and Xray</h1>
      <p className="muted">
        Testimus reads and writes your tests through your own accounts. Nothing is sent anywhere else.
      </p>
      {found && !okAll && (
        <div className="setup-found" role="status">
          <Icon name="info" />
          <p>
            We found the access you already use with Xray Editor. The fields are filled in: just test the connection.
          </p>
        </div>
      )}
      <ConnectAtlassian onStatus={setStatus} onResult={(r) => setOkAll(r.ok)} />
      <div className="setup-actions">
        <span className="spacer" />
        <Button tone="quiet" onClick={onSkip}>
          Skip for now
        </Button>
        <Button tone={okAll || found ? "primary" : "secondary"} icon="right" onClick={onContinue}>
          Continue
        </Button>
      </div>
      <p className="muted">
        Saved in your user folder, shared with your other Atlassian tools. You can change them later in Settings ›
        Access.
      </p>
    </div>
  );
}
