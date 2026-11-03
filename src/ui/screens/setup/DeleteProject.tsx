import { useState } from "react";
import { call } from "../../api.ts";
import { Confirm } from "../../components/ui/index.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export type ProjectTarget = { dir: string; name: string; jiraProject: string };

export function DeleteProject({
  target,
  open,
  onClose,
  onDeleted,
}: {
  target: ProjectTarget;
  open?: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const label = target.name || target.dir;
  return (
    <Confirm
      title="Delete the project folder?"
      confirm="Delete the folder"
      danger
      busy={busy}
      loss={
        <>
          <strong>What is lost: </strong>
          everything in this folder on this PC — documents, tests not pushed yet, the index. Nothing is deleted in Jira.
        </>
      }
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        try {
          await call("project.delete", { dir: target.dir });
          toast({ kind: "info", title: `Project ${label} deleted`, detail: "Jira is untouched." });
          onDeleted();
        } catch (e) {
          errorToast(e, "Could not delete the project");
          setBusy(false);
          onClose();
        }
      }}
    >
      <p>
        <strong>{label}</strong>
        {target.jiraProject && <span className="mono muted"> {target.jiraProject}</span>}
        <br />
        <span className="mono muted setup-proj-dir">{target.dir}</span>
      </p>
      {open && <p>It is the open project: Testimus closes it first.</p>}
    </Confirm>
  );
}
