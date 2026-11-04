import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { fontFamily, fontSize } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  text: { margin: 0 },
  key: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
});

function Confirm({
  title,
  verb,
  danger,
  busy,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  verb: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} size="sm" busy={busy} confirm={{ verb, danger, onConfirm }} onClose={onClose}>
      {children}
    </Modal>
  );
}

export function DownloadConfirm({
  testKey,
  synced,
  busy,
  onConfirm,
  onClose,
}: {
  testKey: string;
  synced: boolean;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Confirm
      title="Download from Jira?"
      verb="Overwrite local"
      danger
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p {...stylex.props(styles.text)}>
        You have local changes to <span {...stylex.props(styles.key)}>{testKey}</span> that have not been pushed.
        Downloading fetches the test as Jira has it right now and replaces the local test.md with it.
      </p>
      <p {...stylex.props(styles.text)}>
        <strong>Local changes that will be lost: </strong>
        {synced ? "everything you edited since the last sync." : "this test was never pushed."}
      </p>
    </Confirm>
  );
}

export function UndoConfirm({
  loss,
  onConfirm,
  onClose,
}: {
  loss: { modified: number; added: number; deleted: number };
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Confirm title="Undo every local change?" verb="Undo local changes" danger onConfirm={onConfirm} onClose={onClose}>
      <p {...stylex.props(styles.text)}>
        test.md goes back to the version of the last sync with Jira, from the local snapshot — nothing is downloaded,
        nothing is pushed.
      </p>
      <p {...stylex.props(styles.text)}>
        <strong>Lost: </strong>
        {loss.modified} modified · {loss.added} added · {loss.deleted} deleted step(s), plus any edit to the header
        fields.
      </p>
    </Confirm>
  );
}

export function RestoreConfirm({
  gone,
  n,
  missing,
  onConfirm,
  onClose,
}: {
  gone: boolean;
  n: number;
  missing: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Confirm
      title={gone ? "Bring the deleted step back?" : `Restore step ${n} from Jira?`}
      verb={gone ? "Bring the step back" : "Restore this step"}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {missing > 0 && (
        <Banner tone="warning" compact>
          Screenshots no longer in the project: {missing} of them — the embed comes back, the picture only after a
          Download from Jira.
        </Banner>
      )}
      <p {...stylex.props(styles.text)}>
        {gone
          ? "The step comes back where it was deleted, as Jira had it at the last sync."
          : "Its fields and screenshots are replaced by what Jira had at the last sync."}
      </p>
    </Confirm>
  );
}
