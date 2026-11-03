import { useState } from "react";
import { call } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { showProject } from "../../lib/desktop.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { Button, Modal } from "../legacy/index.ts";

// ponytail: Xray Editor opens a project from its Jira code (its top bar's « Go ») — a known project with that key,
// else a new project folder named after it beside the current one
export function OpenByKey({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    try {
      const r = await call<{ dir: string; created: boolean }>("project.openKey", { key: k });
      showProject(app, r.dir);
      if (r.created) toast({ kind: "ok", title: `Project ${k.toUpperCase()} created`, detail: r.dir });
      onClose();
    } catch (e) {
      errorToast(e, `Could not open ${k.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      label="Open a project by its Jira key"
      title="Open a project by its Jira key"
      width={420}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={!key.trim() || busy} onClick={() => void go()}>
            Go
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <label className="label" htmlFor="open-key">
          Jira project key
        </label>
        <input
          id="open-key"
          className="field mono"
          placeholder="LFRPS12"
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
        />
        <p className="muted">
          A known project with that key opens; otherwise a new project folder is made beside this one.
        </p>
      </form>
    </Modal>
  );
}
