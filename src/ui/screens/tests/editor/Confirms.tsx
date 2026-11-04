import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { fontFamily, fontSize } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  text: { margin: 0 },
  key: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
});

export type Loss = { modified: number; added: number; deleted: number };

const steps = (n: number, what: string) => `${what} step${n === 1 ? "" : "s"}`;

function Confirm({
  title,
  verb,
  danger,
  busy,
  consequences,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  verb: string;
  danger?: boolean;
  busy?: boolean;
  consequences?: [number | string, string][];
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      size="sm"
      busy={busy}
      confirm={{ verb, danger, onConfirm }}
      consequences={consequences}
      onClose={onClose}
    >
      {children}
    </Modal>
  );
}

export function DownloadConfirm({
  testKey,
  synced,
  loss,
  modifiedSteps = [],
  busy,
  onConfirm,
  onClose,
}: {
  testKey: string;
  synced: boolean;
  /** what the download throws away, against the last sync (none: the snapshot is missing) */
  loss?: Loss;
  /** the numbers of the modified steps */
  modifiedSteps?: number[];
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const where = modifiedSteps.length ? ` (step${modifiedSteps.length > 1 ? "s" : ""} ${modifiedSteps.join(", ")})` : "";
  return (
    <Confirm
      title="Download from Jira?"
      verb="Overwrite local"
      danger
      busy={busy}
      consequences={
        synced && loss
          ? [
              [loss.modified, `${steps(loss.modified, "modified")} ${loss.modified === 1 ? "is" : "are"} lost${where}`],
              [loss.added + loss.deleted, "added or deleted steps"],
            ]
          : undefined
      }
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.key)}>{testKey}</span> has local changes. Downloading replaces the local copy with
        the version in Jira.
      </p>
      <p {...stylex.props(styles.text)}>
        {synced
          ? "Lost: everything you edited since the last sync, header fields included."
          : "Lost: everything local — this test was never pushed."}
      </p>
    </Confirm>
  );
}

export function UndoConfirm({
  loss,
  onConfirm,
  onClose,
}: {
  loss: Loss;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Confirm
      title="Undo every local change?"
      verb="Undo changes"
      danger
      consequences={[
        [loss.modified, steps(loss.modified, "modified")],
        [loss.added, steps(loss.added, "added")],
        [loss.deleted, steps(loss.deleted, "deleted")],
      ]}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p {...stylex.props(styles.text)}>
        The test goes back to its version of the last sync with Jira, from the local snapshot, header fields included —
        nothing is downloaded, nothing is pushed.
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
