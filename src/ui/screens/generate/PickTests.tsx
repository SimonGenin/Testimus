import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { plural } from "../../lib/format.ts";
import { TestPicker } from "../run/TestPicker.tsx";

// ponytail: « Pick tests… » of Ask for changes — New run's picker (filter bar, tree) on the generation's tests only,
// « With a fix » among its findings; what is picked comes back to the column only on « Use »
export function PickTests({
  tests,
  fixes,
  picked,
  onPick,
  onClose,
}: {
  tests: string[];
  fixes: string[];
  picked: string[];
  onPick: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(picked);
  return (
    <Modal
      title="Pick the tests to change"
      subtitle={`Among the ${plural(tests.length, "test")} of this generation.`}
      size="lg"
      onClose={onClose}
      onSubmit={() => ids.length && onPick(ids)}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            type="submit"
            label={ids.length ? `Use these ${plural(ids.length, "test")}` : "Use these tests"}
            disabled={ids.length ? false : "Pick a test first"}
          />
        </>
      }
    >
      <TestPicker only={tests} fixes={fixes} initial={picked} onChange={setIds} />
    </Modal>
  );
}
