import { useState } from "react";
import { useApp } from "../../lib/app.ts";
import { useCommand } from "../../lib/data/query.ts";
import { showProject } from "../../lib/desktop.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Text } from "../ui/Text.tsx";

// ponytail: Xray Editor opens a project from its Jira code (its top bar's « Go ») — a known project with that key,
// else a new project folder named after it beside the current one
export function OpenByKey({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const openKey = useCommand("project.openKey", { invalidates: [["project.list"]] });
  const k = key.trim();
  const go = async () => {
    if (!k) return;
    setBusy(true);
    try {
      const r = await openKey.mutateAsync({ key: k });
      showProject(app, r.dir);
      if (r.created) toast({ kind: "ok", title: `Project ${k} created`, detail: r.dir });
      onClose();
    } catch (e) {
      errorToast(e, `Could not open ${k}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Open a project by its Jira key"
      icon="key"
      size="sm"
      onClose={onClose}
      onSubmit={() => void go()}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" label="Go" loading={busy} disabled={!k} />
        </>
      }
    >
      <Text
        label="Jira project key"
        value={key}
        onChange={(v) => setKey(v.toUpperCase())}
        placeholder="LFRPS12"
        autoFocus
        spellCheck={false}
        hint="A known project with that key opens; otherwise a new project folder is made beside this one."
      />
    </Modal>
  );
}
