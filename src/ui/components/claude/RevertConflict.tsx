import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";

// ponytail: Revert refused because the test changed after the run — said where the run's changes are shown
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
    <Banner
      tone="warning"
      title="Edited after the Claude run"
      actions={
        <>
          <Button size="sm" icon="undo" label="Revert anyway" onClick={onForce} />
          <Button size="sm" variant="quiet" label="Keep the test as it is" onClick={onKeep} />
        </>
      }
    >
      {detail} Reverting anyway puts back the version from before Claude and drops those later edits too.
    </Banner>
  );
}
