import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { color } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  kept: { color: color.textSubtle, whiteSpace: "nowrap" },
});

const HINT =
  "Saved in test.md as the review note when you mark the test. A fix by Claude goes back through the check; it never becomes Validated on its own.";

export type FixNoteProps = {
  id: string;
  /** the note the test already has (marked To fix before) */
  initial: string;
  /** under the title: the test's summary, then its key in mono */
  summary?: string;
  testKey?: string;
  claudeReady: boolean;
  onCancel: () => void;
  onSubmit: (note: string, askClaude: boolean) => void;
};

// ponytail: the To fix note is a draft of the page until the test is marked — nothing is written before (the note lands
// in test.md with the decision); Cancel, Escape and the close button drop it
export function FixNote({ id, initial, summary, testKey, claudeReady, onCancel, onSubmit }: FixNoteProps) {
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
      subtitle={
        summary || testKey ? (
          <>
            {summary}
            {summary && testKey && " · "}
            {testKey && <span {...stylex.props(type.mono)}>{testKey}</span>}
          </>
        ) : undefined
      }
      icon="to-fix"
      onClose={cancel}
      footNote={
        claudeReady ? undefined : (
          <>
            <Icon name="plug" size="sm" />
            Claude is not connected
          </>
        )
      }
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
            disabled={tried && empty}
            onClick={() => submit(false)}
          />
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit(false);
          }
        }}
      >
        <Field
          label="Note for the author — Claude reads it too"
          htmlFor={field}
          hint={tried && empty ? undefined : HINT}
        >
          <ClaudeBlock
            id={field}
            submit="autosave"
            plain
            value={note}
            onChange={setNote}
            autoFocus
            placeholder="Say what is wrong, and what the test should check instead…"
            error={tried && empty ? "Say what is wrong: the note is required." : undefined}
            trailing={
              note && note !== initial ? <span {...stylex.props(type.small, styles.kept)}>Draft kept</span> : undefined
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
