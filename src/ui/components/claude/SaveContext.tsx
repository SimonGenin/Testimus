import { useState } from "react";
import { message } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Text } from "../ui/Text.tsx";
import { useContextWrite } from "./contexts.ts";

// ponytail: a note said for one run becomes a saved context any later run can take
export function SaveContext({
  note,
  onSaved,
  onClose,
}: {
  note: string;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const write = useContextWrite();
  const [name, setName] = useState(note.trim().split("\n")[0].slice(0, 60));
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const c = await write("contexts.create", { name: name.trim(), shared, notes: note.trim() });
      if (!c) return;
      toast({ tone: "success", title: `Context « ${name.trim()} » saved` });
      onSaved(c.id);
      onClose();
    } catch (e) {
      setError(`Could not save the context: ${message(e)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Save as context"
      icon="context"
      size="sm"
      subtitle="The note becomes a saved context: take it in any Claude run later."
      busy={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" label="Save" loading={saving} disabled={!name.trim()} />
        </>
      }
    >
      <Text label="Name" autoFocus value={name} onChange={setName} />
      <Checkbox label="Shared with every project" checked={shared} onChange={setShared} />
    </Modal>
  );
}
