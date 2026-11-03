import { useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Confirm } from "../../components/ui/index.ts";
import { discardEditor } from "../../lib/editorBus.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export type DeleteTarget = Pick<LocalTestRef, "id" | "key" | "summary" | "synced" | "dirty">;

export async function deleteTest(t: DeleteTarget): Promise<boolean> {
  try {
    discardEditor(t.id);
    await call("tests.remove", { id: t.id });
    toast({
      kind: "info",
      title: `Local copy of ${t.key ?? t.id} deleted`,
      detail: t.key ? "The Jira test is untouched." : undefined,
    });
    return true;
  } catch (e) {
    errorToast(e, "Could not delete the local copy");
    return false;
  }
}

// ponytail: a pushed, unchanged copy can be pulled again, so it goes without asking; the only copy, or
// one with unpushed changes, asks first
export const needsAsking = (t: DeleteTarget) => !t.synced || t.dirty;

export function DeleteTest({
  target,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Confirm
      title="Delete the local copy?"
      confirm="Delete local copy"
      danger
      busy={busy}
      loss={
        <>
          <strong>What is lost: </strong>
          {!target.synced
            ? "this test was never pushed, so this is the only copy."
            : target.dirty
              ? "the local changes you have not pushed yet — the Jira test is left untouched."
              : "nothing — the Jira test is left untouched and can be pulled again."}
        </>
      }
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        const ok = await deleteTest(target);
        setBusy(false);
        if (ok) onDeleted();
        else onClose();
      }}
    >
      <p>
        <span className="mono">{target.key ?? target.id}</span> — {target.summary || "Untitled"} — and its screenshots
        are removed from the project folder.
      </p>
    </Confirm>
  );
}
