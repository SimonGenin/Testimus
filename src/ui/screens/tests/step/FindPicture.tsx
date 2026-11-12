import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { PictureSearch } from "./PictureSearch.tsx";

export type Found = CommandOutput<"tests.findImage">;
export type FoundPicture = Found["pictures"][number];

// ponytail: a step's « Find a picture » — a short Claude run (tests.findImage) looks for its screen in the documents'
// figures, the photos and the videos, and proposes up to three; the person adds the one that shows it (tests.addImage,
// or the editor's own add, which saves the test around it). Finding none is said plainly: a step may go without one.
// The search starts when the dialog opens, and only then does anything read or ask
export function FindPicture({
  testId,
  step,
  disabled,
  onAdd,
}: {
  testId: string;
  step: number;
  disabled?: boolean | string;
  /** adds the picture picked; by default tests.addImage */
  onAdd?: (p: FoundPicture) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="claude-quiet"
        size="sm"
        icon="image"
        label="Find a picture"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="step-find-picture"
      />
      {open && <PictureSearch testId={testId} step={step} onAdd={onAdd} onClose={() => setOpen(false)} />}
    </>
  );
}
