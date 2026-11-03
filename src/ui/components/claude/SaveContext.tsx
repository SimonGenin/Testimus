import { useState } from "react";
import { call } from "../../api.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Button, Modal } from "../legacy/index.ts";
import { CONTEXTS_EVENT, type ContextSummary } from "./ContextsDialog.tsx";

export function SaveContext({
  note,
  onSaved,
  onClose,
}: {
  note: string;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(note.trim().split("\n")[0].slice(0, 60));
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const c = await call<ContextSummary>("contexts.create", { name: name.trim(), shared, notes: note.trim() });
      window.dispatchEvent(new Event(CONTEXTS_EVENT));
      toast({ kind: "ok", title: `Context « ${name.trim()} » saved` });
      onSaved(c.id);
      onClose();
    } catch (e) {
      errorToast(e, "Could not save the context");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      label="Save as context"
      title="Save as context"
      subtitle="The note becomes a saved context: import it in any Claude run later."
      width={480}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" disabled={!name.trim() || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <label className="label" htmlFor="ctx-save-name">
        Name
      </label>
      <input
        id="ctx-save-name"
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) void save();
        }}
      />
      <label className="ctxdlg-share">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        Shared with every project
      </label>
    </Modal>
  );
}
