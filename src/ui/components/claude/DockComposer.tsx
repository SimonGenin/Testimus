import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { Popover } from "../ui/Popover.tsx";
import { Text } from "../ui/Text.tsx";
import { ContextPicker } from "./ContextPicker.tsx";
import { ContextsDialog } from "./ContextsDialog.tsx";
import type { ContextSummary } from "./contexts.ts";
import { CustomModel, effortOptions, useModelChoice } from "./ModelPicker.tsx";
import { SaveContext } from "./SaveContext.tsx";

const styles = stylex.create({
  extra: { display: "flex", flexDirection: "column", gap: space.s2, paddingInline: space.s3, paddingBottom: space.s2 },
});

export type RunContexts = {
  /** what the run reads unless changed here (the test's list, the project's); empty for the documents */
  effective: string[];
  /** changes made for this run only: a context switched off, or one added */
  pick: Record<string, boolean>;
  setPick: (p: Record<string, boolean>) => void;
};

export const included = (c: RunContexts, id: string) => c.pick[id] ?? c.effective.includes(id);
export const runIds = (c: RunContexts) =>
  [...new Set([...c.effective, ...Object.keys(c.pick)])].filter((id) => included(c, id));

// ponytail: the dock's one box — the Claude block with this run's contexts, the quick asks, a note for this run, the
// model and effort; the prompt and the note stay when the screen changes
export function DockComposer({
  mode,
  label,
  placeholder,
  scope,
  quickAsks,
  contexts,
  all,
  model,
  effort,
  running,
  unavailable,
  onModel,
  onEffort,
  onCancel,
  onSend,
  keepAfterSend,
  focusKey,
}: {
  mode: "docs" | "test";
  label: string;
  placeholder: string;
  scope: string;
  quickAsks: { label: string; prompt: string }[];
  contexts: RunContexts;
  /** the saved contexts, for their names and the picker */
  all: ContextSummary[];
  model: string;
  effort: Effort;
  running: number | null;
  unavailable?: string;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
  onCancel?: () => void;
  onSend: (prompt: string, note: string, quickAsk?: string) => void;
  keepAfterSend: boolean;
  /** a new value puts the caret in the box (a question handed over by the app) */
  focusKey: number;
}) {
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);
  const p = project();
  const [prompt, setPrompt] = useDraft([p, "dock.prompt"]);
  const [note, setNote] = useDraft([p, "dock.note"]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const [picking, setPicking] = useState(false);
  const choice = useModelChoice(model, onModel);
  const shownIds = [
    ...new Set([...contexts.effective, ...Object.keys(contexts.pick).filter((id) => contexts.pick[id])]),
  ];
  const nameOf = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const toggle = (id: string, on: boolean) => contexts.setPick({ ...contexts.pick, [id]: on });

  return (
    <>
      <ClaudeBlock
        ariaLabel={label}
        inputRef={input}
        placeholder={placeholder}
        value={prompt}
        onChange={setPrompt}
        contexts={shownIds.map((id) => ({ id, label: nameOf(id), on: included(contexts, id) }))}
        onContext={toggle}
        addContext={
          <Popover
            trigger={<Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" />}
            title="Add context"
            icon="context"
            width="sm"
            open={picking}
            onOpenChange={setPicking}
          >
            <ContextPicker
              all={all}
              isOn={(id) => included(contexts, id)}
              onToggle={toggle}
              onNew={() => {
                setPicking(false);
                setDialog("save");
              }}
              onManage={() => {
                setPicking(false);
                setDialog("manage");
              }}
              extra={
                !noteOpen &&
                !note.trim() && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="text"
                    label="Add a note for this run"
                    onClick={() => {
                      setPicking(false);
                      setNoteOpen(true);
                    }}
                  />
                )
              }
            />
          </Popover>
        }
        quickAsks={mode === "test" ? quickAsks : undefined}
        model={{ value: choice.selected, options: choice.options, onChange: choice.pick }}
        effort={{ value: effort, options: effortOptions, onChange: (e) => onEffort(e as Effort) }}
        scope={scope}
        allowEmpty={mode === "test"}
        submitLabel={mode === "docs" ? "Ask" : "Send"}
        running={running}
        onCancel={onCancel}
        unavailable={unavailable}
        onSubmit={(text) => {
          const asked = quickAsks.find((q) => q.prompt === text)?.label;
          onSend(text, note, asked);
          if (!keepAfterSend) setPrompt("");
        }}
      >
        {(noteOpen || !!note.trim() || choice.custom) && (
          <div {...stylex.props(styles.extra)}>
            {(noteOpen || !!note.trim()) && (
              <Text
                multiline
                size="sm"
                ariaLabel="Note for this run"
                placeholder="Anything Claude should know for this run…"
                autoFocus={noteOpen && !note}
                readOnly={running !== null}
                value={note}
                onChange={setNote}
              />
            )}
            <CustomModel choice={choice} />
          </div>
        )}
      </ClaudeBlock>
      {dialog === "save" && (
        <SaveContext
          note={note}
          onSaved={(id) => {
            toggle(id, true);
            setNote("");
            setNoteOpen(false);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
