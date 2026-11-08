import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { RadioGroup } from "../../components/ui/RadioGroup.tsx";
import { Text } from "../../components/ui/Text.tsx";
import type { ImagesChoice as Choice } from "../../lib/uploads.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
});

const today = () => new Date().toISOString().slice(0, 10);

// ponytail: several images picked together are one document, as several sections are one — or each its own document;
// the person says which, and names the one document (default « Images <date> »)
export function ImagesChoice({
  count,
  onChoose,
  onClose,
}: {
  count: number;
  onChoose: (choice: Choice) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Choice["images"]>("together");
  const [title, setTitle] = useState(`Images ${today()}`);
  const go = () => {
    onChoose(
      mode === "together" ? { images: "together", title: title.trim() || `Images ${today()}` } : { images: "each" },
    );
    onClose();
  };
  return (
    <Modal
      title={`Add ${count} images`}
      subtitle="Images are documents of their own: they show what the real system does, and a test cites them for how to do a step."
      size="sm"
      onClose={onClose}
      onSubmit={go}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            type="submit"
            label={mode === "together" ? "Add one document" : `Add ${count} documents`}
          />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <RadioGroup
          label="How the images become documents"
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "together",
              label: `One document with the ${count} images`,
              hint: "A visit, a screen and its menus: the images are read together, each its anchor img:N.",
            },
            {
              value: "each",
              label: "One document per image",
              hint: "Images that have nothing to do with each other.",
            },
          ]}
        />
        {mode === "together" && <Text label="Title" value={title} onChange={setTitle} autoFocus />}
      </div>
    </Modal>
  );
}
