import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";

// ponytail: a planned test's new name, or a new theme for it — one field, Enter applies
export function PlanName({
  title,
  label,
  value,
  onApply,
  onClose,
}: {
  title: string;
  label: string;
  value: string;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const ok = text.trim().length >= 3;
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      onSubmit={() => ok && onApply(text.trim())}
      actions={
        <>
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" label="Apply" disabled={!ok} />
        </>
      }
    >
      <Text label={label} value={text} onChange={setText} />
    </Modal>
  );
}
