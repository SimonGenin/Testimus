import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  note: { display: "flex", flexDirection: "column", gap: space.s2 },
  label: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  hint: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  kept: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle, whiteSpace: "nowrap" },
});

const HINT =
  "Saved in test.md as the review note when you mark the test. A fix by Claude goes back through the check; it never becomes Validated on its own.";

export type FixNoteProps = {
  id: string;
  /** the note the test already has (marked To fix before) */
  initial: string;
  /** « Summary · KEY », under the title */
  subtitle?: string;
  claudeReady: boolean;
  onCancel: () => void;
  onSubmit: (note: string, askClaude: boolean) => void;
};

// ponytail: the To fix note is a draft of the page until the test is marked — nothing is written before (the note lands
// in test.md with the decision); Cancel, Escape and the close button drop it
export function FixNote({ id, initial, subtitle, claudeReady, onCancel, onSubmit }: FixNoteProps) {
  const [note, setNote, drop] = useDraft([project(), "review.fixNote", { id }], initial);
  const [tried, setTried] = useState(false);
  const field = useId();
  const empty = !note.trim();
  const cancel = () => {
    drop();
    onCancel();
  };
  const submit = (ask: boolean) => {
    if (empty) {
      setTried(true);
      return;
    }
    drop();
    onSubmit(note.trim(), ask && claudeReady);
  };
  return (
    <Modal
      title="What needs fixing?"
      subtitle={subtitle}
      icon="to-fix"
      onClose={cancel}
      actions={
        <>
          <Button label="Cancel" onClick={cancel} />
          <Button
            variant="claude-quiet"
            icon="claude"
            label="Ask Claude to fix it"
            disabled={
              !claudeReady
                ? "Claude is not available on this PC right now — the note is kept for later"
                : empty && "Write the note first: Claude fixes the test from it"
            }
            onClick={() => submit(true)}
          />
          <Button
            variant="primary"
            icon="to-fix"
            label="Mark To fix"
            shortcut="Ctrl Enter"
            disabled={tried && empty}
            onClick={() => submit(false)}
          />
        </>
      }
    >
      <div
        {...stylex.props(styles.note)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit(false);
          }
        }}
      >
        <label htmlFor={field} {...stylex.props(styles.label)}>
          Note for the author — Claude reads it too
        </label>
        <ClaudeBlock
          id={field}
          submit="autosave"
          plain
          value={note}
          onChange={setNote}
          autoFocus
          placeholder="Say what is wrong, and what the test should check instead…"
          error={tried && empty ? "Say what is wrong: the note is required." : undefined}
          trailing={note && note !== initial ? <span {...stylex.props(styles.kept)}>Draft kept</span> : undefined}
        />
        <p {...stylex.props(styles.hint)}>{HINT}</p>
      </div>
    </Modal>
  );
}
