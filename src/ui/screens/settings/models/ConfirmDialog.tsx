import type { ReactNode } from "react";
import { Button, Modal } from "../../../components/legacy/index.ts";

export function ConfirmDialog({
  title,
  confirm,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  confirm: string;
  children: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      label={title}
      title={title}
      width={480}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
