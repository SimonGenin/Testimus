import * as stylex from "@stylexjs/stylex";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type { LocalTestRef } from "../../../core/types.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { execute, key } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { fontFamily, fontSize } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  key: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
  text: { margin: 0 },
});

export type DeleteTarget = Pick<LocalTestRef, "id" | "key" | "summary" | "synced" | "dirty"> & {
  /** the steps changed since the last sync, when the editor knows them */
  loss?: { modified: number; added: number; deleted: number };
};

function lost(t: DeleteTarget): [number | string, string][] | undefined {
  if (!t.synced) return [[1, "test never pushed: this is its only copy"]];
  if (!t.dirty || !t.loss) return undefined;
  const n = t.loss.modified + t.loss.added + t.loss.deleted;
  return n ? [[n, `local change${n === 1 ? "" : "s"} never pushed ${n === 1 ? "is" : "are"} lost`]] : undefined;
}

// ponytail: a test about to be deleted must not be written back by its pending autosave — the save would fail on a
// folder that is gone, or come back as an error on screen
export async function deleteTest(client: QueryClient, t: DeleteTarget): Promise<boolean> {
  try {
    discardAutosave(key("tests.show", { id: t.id }));
    await execute(
      client,
      "tests.remove",
      { id: t.id },
      {
        invalidates: [["tests.list"], ["review.queue"], ["project.info"], ["search.all"]],
      },
    );
    client.removeQueries({ queryKey: key("tests.show", { id: t.id }) as unknown as readonly unknown[] });
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
  const client = useQueryClient();
  return (
    <Modal
      title="Delete the local copy?"
      size="sm"
      consequences={lost(target)}
      confirm={{
        verb: "Delete",
        danger: true,
        onConfirm: async () => {
          if (await deleteTest(client, target)) onDeleted();
          else onClose();
        },
      }}
      onClose={onClose}
    >
      <p {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.key)}>{target.key ?? target.id}</span> — {target.summary || "Untitled"} —{" "}
        {target.key ? "stays in Jira. Its" : "Its"} test.md, its images and its review state are removed from the
        project.
      </p>
      <p {...stylex.props(styles.text)}>
        {!target.synced
          ? "This test was never pushed, so this is the only copy."
          : target.dirty
            ? "Lost: the local changes you have not pushed yet — the Jira test is left untouched."
            : "Nothing is lost — the Jira test is left untouched and can be pulled again."}
      </p>
    </Modal>
  );
}
