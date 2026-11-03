import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/index.ts";
import { dropDraft, useDraft } from "../../lib/drafts.ts";

export function FixNote({
  id,
  initial,
  claudeReady,
  onCancel,
  onSubmit,
}: {
  id: string;
  initial: string;
  claudeReady: boolean;
  onCancel: () => void;
  onSubmit: (note: string, askClaude: boolean) => void;
}) {
  const draft = `review.fixNote.${id}`;
  const [note, setNote] = useDraft(draft, initial);
  const [ask, setAsk] = useState(claudeReady);
  const [tried, setTried] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, []);
  const submit = () => {
    if (!note.trim()) {
      setTried(true);
      area.current?.focus();
      return;
    }
    dropDraft(draft);
    onSubmit(note.trim(), ask && claudeReady);
  };
  return (
    <div
      className="fixnote"
      role="dialog"
      aria-label="Mark as To fix"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          dropDraft(draft);
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <h3 className="h fixnote-title">What needs fixing?</h3>
      <label htmlFor="fixnote" className="label">
        Note for the author — Claude reads it too
      </label>
      <textarea
        id="fixnote"
        ref={area}
        className="field"
        rows={4}
        value={note}
        aria-invalid={tried && !note.trim()}
        aria-describedby={tried && !note.trim() ? "fixnote-err" : undefined}
        onChange={(e) => setNote(e.target.value)}
      />
      {tried && !note.trim() && (
        <span id="fixnote-err" className="sev s-err" role="alert">
          Say what is wrong: the note is required.
        </span>
      )}
      <label className="fixnote-ask">
        <input
          type="checkbox"
          checked={ask && claudeReady}
          disabled={!claudeReady}
          onChange={(e) => setAsk(e.target.checked)}
        />
        <span>
          <span className="fixnote-ask-title">Then ask Claude to fix it</span>
          <br />
          <span className="muted">
            {claudeReady
              ? "The fix goes back through the check. It never becomes Validated on its own."
              : "Claude is not available on this PC right now — the note is kept for later."}
          </span>
        </span>
      </label>
      <div className="fixnote-foot">
        <Button
          tone="quiet"
          onClick={() => {
            dropDraft(draft);
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button tone="primary" kbd="Enter" onClick={submit}>
          Mark To fix
        </Button>
      </div>
    </div>
  );
}
