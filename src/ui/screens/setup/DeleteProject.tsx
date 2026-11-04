import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Modal } from "../../components/ui/Modal.tsx";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0 },
  name: { fontWeight: fontWeight.semibold, color: color.text },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
    overflowWrap: "anywhere",
  },
});

export type ProjectTarget = { dir: string; name: string; jiraProject: string };

export function DeleteProject({
  target,
  open,
  onClose,
  onDelete,
}: {
  target: ProjectTarget;
  open?: boolean;
  onClose: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Delete the project folder?"
      size="sm"
      busy={busy}
      confirm={{
        verb: "Delete the folder",
        danger: true,
        onConfirm: async () => {
          setBusy(true);
          await onDelete();
          setBusy(false);
          onClose();
        },
      }}
      consequences={[
        ["What is lost:", "everything in this folder on this PC — documents, tests not pushed yet, the index"],
        ["Jira is untouched:", "Nothing is deleted in Jira."],
      ]}
      onClose={onClose}
    >
      <span {...stylex.props(styles.body)}>
        <span>
          <span {...stylex.props(styles.name)}>{target.name || target.dir}</span>
          {target.jiraProject && <span {...stylex.props(styles.mono)}> {target.jiraProject}</span>}
        </span>
        <span {...stylex.props(styles.mono)}>{target.dir}</span>
        {open && <span>It is the open project: Testimus closes it first.</span>}
      </span>
    </Modal>
  );
}
