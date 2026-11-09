import { useEffect, useRef } from "react";
import type { Effort } from "../../../core/types.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import type { ContextSummary } from "./contexts.ts";
import { effortOptions, useModelChoice } from "./ModelPicker.tsx";

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
// prompt stays when the screen changes
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
  const choice = useModelChoice(model, onModel);
  const shownIds = [
    ...new Set([...contexts.effective, ...Object.keys(contexts.pick).filter((id) => contexts.pick[id])]),
  ];
  const nameOf = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const toggle = (id: string, on: boolean) => contexts.setPick({ ...contexts.pick, [id]: on });

  return (
    <ClaudeBlock
      ariaLabel={label}
      inputRef={input}
      placeholder={placeholder}
      value={prompt}
      onChange={setPrompt}
      contexts={shownIds.map((id) => ({ id, label: nameOf(id), on: included(contexts, id) }))}
      onContext={toggle}
      addContext={
        <ContextMenu
          isOn={(id) => included(contexts, id)}
          onToggle={toggle}
          text={prompt}
          onSaved={(id) => {
            toggle(id, true);
            setPrompt("");
          }}
          disabled={running !== null}
          foot="Ticked contexts go with this run only. The project's defaults are in Settings › Claude."
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
  );
}
