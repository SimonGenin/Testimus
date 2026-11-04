import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Text } from "../ui/Text.tsx";
import { ContextPicker } from "./ContextPicker.tsx";
import { ContextsDialog } from "./ContextsDialog.tsx";
import { useContexts } from "./contexts.ts";
import { SaveContext } from "./SaveContext.tsx";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  acts: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

// ponytail: every Claude run takes the same extra context — saved contexts (pointed at) and a note (said in
// full); the list and the note belong to the caller, for one run or for what it is about (`of`)
export function AdditionalContext({
  id,
  ids,
  note,
  of = "this run",
  placeholder,
  compact,
  disabled,
  onIds,
  onNote,
  onNoteBlur,
}: {
  id: string;
  ids: string[];
  note: string;
  of?: string;
  /** kept for callers that label the note themselves; the note is named « Note for … » either way */
  labelled?: boolean;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  onIds: (ids: string[]) => void;
  onNote: (note: string) => void;
  onNoteBlur?: () => void;
}) {
  const all = useContexts() ?? [];
  const [dialog, setDialog] = useState<"import" | "save" | "manage" | null>(null);
  const [writing, setWriting] = useState(false);
  const known = ids.filter((x) => all.some((c) => c.id === x) || !all.length);
  const showNote = !compact || writing || !!note.trim();
  return (
    <div {...stylex.props(styles.box)}>
      {known.length > 0 && (
        <div {...stylex.props(styles.chips)}>
          {known.map((x) => {
            const c = all.find((cc) => cc.id === x);
            return (
              <Chip
                key={x}
                label={c?.name ?? x}
                tone="claude"
                icon="context"
                disabled={disabled}
                onRemove={disabled ? undefined : () => onIds(known.filter((y) => y !== x))}
                removeLabel={`Leave ${c?.name ?? x} out of ${of}`}
              />
            );
          })}
        </div>
      )}
      {showNote && (
        <Text
          id={id}
          multiline
          ariaLabel={`Note for ${of}`}
          placeholder={placeholder ?? `Anything Claude should know for ${of}…`}
          value={note}
          disabled={disabled}
          autoFocus={compact && writing && !note}
          onChange={onNote}
          onBlur={onNoteBlur}
        />
      )}
      <div {...stylex.props(styles.acts)}>
        <Button
          size="sm"
          icon="context"
          label={compact ? "Import saved" : "Import saved context"}
          disabled={disabled}
          onClick={() => setDialog("import")}
        />
        {!showNote && (
          <Button
            size="sm"
            variant="quiet"
            icon="plus"
            label="Add a note"
            disabled={disabled}
            onClick={() => setWriting(true)}
          />
        )}
        {showNote && (
          <Button
            size="sm"
            variant="quiet"
            label="Save the note as a context…"
            disabled={disabled ? true : !note.trim() ? "Write a note first" : false}
            onClick={() => setDialog("save")}
          />
        )}
      </div>
      {dialog === "import" && (
        <Modal
          title="Saved contexts"
          icon="context"
          size="sm"
          subtitle="Reference material Claude reads before this run: notes, files, folders."
          onClose={() => setDialog(null)}
          actions={<Button variant="primary" label="Done" onClick={() => setDialog(null)} />}
        >
          <ContextPicker
            all={all}
            isOn={(x) => ids.includes(x)}
            onToggle={(x, on) => onIds(on ? [...ids, x] : ids.filter((y) => y !== x))}
            onManage={() => setDialog("manage")}
            foot={`Ticked contexts go with ${of}.`}
          />
        </Modal>
      )}
      {dialog === "save" && (
        <SaveContext
          note={note}
          onSaved={(cid) => {
            onIds([...ids, cid]);
            onNote("");
            setWriting(false);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
