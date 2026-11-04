import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { ContextPicker } from "./ContextPicker.tsx";
import type { ContextSummary } from "./contexts.ts";

// ponytail: the saved contexts a whole list takes (a document's contexts), ticked then used at once — the dock's own
// picker applies each tick to its run instead
export function ImportContexts({
  all,
  picked,
  onUse,
  onManage,
  onClose,
}: {
  all: ContextSummary[];
  picked: string[];
  onUse: (ids: string[]) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<string[]>(picked);
  return (
    <Modal
      title="Saved contexts"
      icon="context"
      size="sm"
      subtitle="Reference material Claude reads: notes, files, folders."
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" label="Manage contexts…" onClick={onManage} />
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            label={on.length ? `Use ${on.length}` : "Use none"}
            onClick={() => {
              onUse(on);
              onClose();
            }}
          />
        </>
      }
    >
      <ContextPicker
        all={all}
        isOn={(id) => on.includes(id)}
        onToggle={(id, yes) => setOn((l) => (yes ? [...l, id] : l.filter((x) => x !== id)))}
        foot="Ticked contexts are read with this document."
      />
    </Modal>
  );
}
