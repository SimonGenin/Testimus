import { useEffect, useRef } from "react";
import type { Effort } from "../../../core/types.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { effortOptions, useModelChoice } from "./ModelPicker.tsx";
import type { RunContext } from "./useRunContext.tsx";

// ponytail: the dock's one box — the Claude block with what goes with this run (Context), the quick asks, the model
// and effort; the prompt stays when the screen changes
export function DockComposer({
  mode,
  label,
  placeholder,
  scope,
  quickAsks,
  context,
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
  /** what goes with the run: the button, from the dock's useRunContext */
  context: RunContext["context"];
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

  return (
    <ClaudeBlock
      ariaLabel={label}
      inputRef={input}
      placeholder={placeholder}
      value={prompt}
      onChange={setPrompt}
      context={context}
      quickAsks={mode === "test" ? quickAsks : undefined}
      model={{ value: choice.selected, options: choice.options, onChange: choice.pick }}
      effort={{ value: effort, options: effortOptions, onChange: (e) => onEffort(e as Effort) }}
      scope={mode === "test" ? scope : undefined}
      allowEmpty={mode === "test"}
      submitLabel={mode === "docs" ? "Ask" : "Send"}
      running={running}
      sentShown
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
