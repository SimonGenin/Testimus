import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { desktop, examplePath, pickFiles } from "../../lib/desktop.ts";

const FILTERS = [{ name: "Word or PDF", extensions: ["docx", "pdf"] }];

// ponytail: a path typed or pasted (quotes from « Copy as path » dropped); Browse… is the desktop's picker
export function AddPath({ onAdd, onClose }: { onAdd: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState("");
  const clean = path.trim().replace(/^"|"$/g, "");
  const add = () => {
    if (!clean) return;
    onAdd(clean);
    onClose();
  };
  return (
    <Modal
      title="Add a document from a path"
      subtitle="A .docx (preferred) or .pdf on this PC or a synced share. It is copied into the project; the original is never changed."
      icon="folder-open"
      onClose={onClose}
      onSubmit={add}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" label="Add" disabled={!clean} />
        </>
      }
    >
      <Text
        label="Path of the file"
        value={path}
        onChange={setPath}
        autoFocus
        placeholder={examplePath("C:\\…\\SOSIE_211_D401-1_3_01.01.docx", "/Users/you/…/SOSIE_211_D401-1_3_01.01.docx")}
        trailing={
          desktop() ? (
            <Button
              size="sm"
              variant="quiet"
              label="Browse…"
              onClick={() =>
                void pickFiles("Add a document", FILTERS, false).then(([picked]) => picked && setPath(picked))
              }
            />
          ) : undefined
        }
      />
    </Modal>
  );
}
