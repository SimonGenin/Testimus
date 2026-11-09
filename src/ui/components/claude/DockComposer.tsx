import { useEffect, useRef, useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { contextLabel } from "../../lib/labels.ts";
import { Button } from "../ui/Button.tsx";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { Menu } from "../ui/Menu.tsx";
import { ContextsDialog } from "./ContextsDialog.tsx";
import type { ContextSummary } from "./contexts.ts";
import { effortOptions, useModelChoice } from "./ModelPicker.tsx";
import { SaveContext } from "./SaveContext.tsx";

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

// ponytail: the dock's one box — the Claude block with this run's contexts, the quick asks, the model and effort; the
// prompt stays when the screen changes, and what is written there can be saved as a context
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
  onSend: (prompt: string, quickAsk?: string) => void;
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
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
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
          <Menu
            label="Add context"
            trigger={<Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" />}
            entries={[
              { group: "Saved contexts — this run" },
              ...(all.length
                ? all.map((c) => ({
                    label: contextLabel(c),
                    icon: "context" as const,
                    hint: c.shared ? "shared" : "this project",
                    checked: included(contexts, c.id),
                    keepOpen: true,
                    onSelect: () => toggle(c.id, !included(contexts, c.id)),
                  }))
                : [{ note: "No saved context yet — write in the box and save the text as a context." }]),
              "separator",
              {
                label: "Save the text as a context…",
                icon: "plus",
                disabled: prompt.trim() ? false : "Write in the box first",
                onSelect: () => setDialog("save"),
              },
              { label: "Manage contexts…", icon: "settings", onSelect: () => setDialog("manage") },
              { note: "Ticked contexts go with this run only. The project's defaults are in Settings › Claude." },
            ]}
          />
        }
        quickAsks={mode === "test" ? quickAsks : undefined}
        model={{ value: choice.selected, options: choice.options, onChange: choice.pick }}
        effort={{ value: effort, options: effortOptions, onChange: (e) => onEffort(e as Effort) }}
        scope={mode === "test" ? scope : undefined}
        allowEmpty={mode === "test"}
        submitLabel={mode === "docs" ? "Ask" : "Send"}
        running={running}
        onCancel={onCancel}
        unavailable={unavailable}
        onSubmit={(text) => {
          const asked = quickAsks.find((q) => q.prompt === text)?.label;
          onSend(text, asked);
          if (!keepAfterSend) setPrompt("");
        }}
      />
      {dialog === "save" && (
        <SaveContext
          note={prompt}
          onSaved={(id) => {
            toggle(id, true);
            setPrompt("");
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
