import { useState } from "react";
import type { CredsStatus } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ConnectAtlassian } from "../settings/ConnectAtlassian.tsx";
import { StepCard } from "./StepCard.tsx";

export function AccessStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<CredsStatus | null>(null);
  const [okAll, setOkAll] = useState(false);
  const found = !!status?.jira.complete && !!status?.xray.complete;
  return (
    <StepCard
      id="access-h"
      title="Connect to Jira and Xray"
      lead="Testimus reads and writes your tests through your own accounts. Nothing is sent anywhere else. Saved in your user folder, shared with your other Atlassian tools; you can change them later in Settings › Access."
      actions={
        <>
          <Button variant="quiet" size="lg" label="Skip for now" onClick={onSkip} />
          <Button
            variant={okAll || found ? "primary" : "secondary"}
            size="lg"
            iconAfter="chevron-right"
            label="Continue"
            disabled={!(okAll || found) && "Save and test the connection first — or skip for now"}
            onClick={onContinue}
          />
        </>
      }
    >
      {found && !okAll && (
        <Banner tone="info">
          We found the access you already use with Xray Editor. The fields are filled in: just test the connection.
        </Banner>
      )}
      <ConnectAtlassian
        saveVariant={okAll || found ? "secondary" : "primary"}
        onStatus={setStatus}
        onResult={(r) => setOkAll(r.ok)}
      />
    </StepCard>
  );
}
