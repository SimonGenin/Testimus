import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Modal } from "./Modal.tsx";

export function Confirm({
  title,
  confirm,
  danger,
  loss,
  children,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  confirm: string;
  danger?: boolean;
  loss?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      label={title}
      title={title}
      width={500}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      {children}
      {loss && <div className="loss">{loss}</div>}
    </Modal>
  );
}
