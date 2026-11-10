import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { key, useRead } from "../../lib/data/query.ts";
import { contextLabel } from "../../lib/labels.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { type } from "../ui/type.ts";
import { ContextEditor, useWords } from "./ContextEditor.tsx";
import { type ContextDetail, useContextWrite } from "./contexts.ts";

const styles = stylex.create({
  where: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textSubtle },
});

// ponytail: one saved context, edited where it is ticked (the Context dialog of a Claude block, a standing list) — its
// name and notes save themselves, sharing, paths and files are one gesture each, Delete asks first and says who else
// loses it; what is typed is written when the dialog closes
export function ContextEdit({ id, onClose }: { id: string; onClose: () => void }) {
  const write = useContextWrite();
  const read = useRead("contexts.show", { id });
  const detail = read.data as unknown as ContextDetail | undefined;
  const words = useWords(id, detail);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (read.error) errorToast(read.error, "Could not open the context");
  }, [read.error]);

  const remove = async () => {
    discardAutosave(key("contexts.show", { id }));
    try {
      await write("contexts.remove", { id });
    } catch (e) {
      throw new Error(`Could not delete the context: ${e instanceof Error ? e.message : String(e)}`);
    }
    onClose();
  };

  return (
    <Modal
      title="Edit the context"
      icon="context"
      subtitle="Notes, files and folders Claude reads before it works."
      onClose={onClose}
      footNote={
        detail && (
          <span {...stylex.props(styles.where)}>
            <Icon name="folder" size="sm" />
            {detail.shared ? "In the shared library" : "In this project"}
            {detail.shared && <span {...stylex.props(type.small, styles.muted)}>· deleted for every project</span>}
          </span>
        )
      }
      actions={
        <>
          {detail && <Button variant="quiet" icon="trash" label="Delete context…" onClick={() => setDeleting(true)} />}
          <Button variant="primary" label="Done" onClick={onClose} />
        </>
      }
    >
      {deleting && detail && (
        <Modal
          title="Delete the context?"
          size="sm"
          confirm={{ verb: "Delete the context", danger: true, onConfirm: remove }}
          consequences={[
            [
              "",
              detail.shared
                ? "It is shared: it is deleted for every project, not only this one."
                : "It is deleted from this project.",
            ],
            ["", "The tests, documents and project defaults that named it stop taking it. This cannot be undone."],
          ]}
          onClose={() => setDeleting(false)}
        >
          {`« ${contextLabel(words.value ?? detail)} » — its notes, files and paths.`}
        </Modal>
      )}
      {detail ? (
        <ContextEditor key={detail.id} detail={detail} words={words} />
      ) : read.error ? null : (
        <>
          <Skeleton lines={4} />
          <Loading read="contexts.show" />
        </>
      )}
    </Modal>
  );
}
