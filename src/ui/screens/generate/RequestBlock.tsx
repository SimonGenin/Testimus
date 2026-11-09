import { ContextMenu } from "../../components/claude/ContextMenu.tsx";
import { cap, EFFORTS, MODELS } from "../../components/claude/ModelPicker.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { useRead } from "../../lib/data/query.ts";
import type { GenerateForm } from "./useGenerateForm.ts";

type ContextRow = { id: string; name: string; shared?: boolean };

// ponytail: the request is the Claude block — contexts, model and effort in it; the Generate button lives in the form's
// foot, Ctrl+Enter here presses it
export function RequestBlock({
  form,
  readOnly,
  unavailable,
  onGenerate,
}: {
  form: GenerateForm;
  readOnly: boolean;
  unavailable?: string;
  onGenerate: () => void;
}) {
  const list = useRead("contexts.list", {});
  const all = (list.data ?? []) as ContextRow[];
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const isOn = (id: string) => form.chips.some((c) => c.id === id && c.on);
  const toggle = (id: string, on: boolean) =>
    form.setChips(
      form.chips.some((c) => c.id === id)
        ? form.chips.map((c) => (c.id === id ? { id, on } : c))
        : [...form.chips, { id, on }],
    );

  const known = form.model && !MODELS.includes(form.model) ? [form.model] : [];
  const fallbackModel = MODELS.includes(form.defaultModel) ? [] : [form.defaultModel];

  return (
    <ClaudeBlock
      id="gen-request"
      ariaLabel="What should be tested?"
      placeholder="A feature, a screen, an operator procedure… in your own words. Empty: everything the scope below specifies."
      value={form.request}
      onChange={form.setRequest}
      readOnly={readOnly}
      disabled={readOnly}
      unavailable={unavailable}
      submit="none"
      allowEmpty={!form.empty}
      onSubmit={onGenerate}
      contexts={form.chips.map((c) => ({ id: c.id, label: name(c.id), on: c.on }))}
      onContext={toggle}
      addContext={
        <ContextMenu
          isOn={isOn}
          onToggle={toggle}
          text={form.request}
          onSaved={(id) => {
            form.setChips([...form.chips, { id, on: true }]);
            form.setRequest("");
          }}
          disabled={readOnly}
        />
      }
      model={{
        value: form.model,
        shown: cap(form.model || form.defaultModel),
        options: [
          { value: "", label: `Project default · ${cap(form.defaultModel)}` },
          ...[...fallbackModel, ...MODELS, ...known].map((m) => ({ value: m, label: cap(m) })),
        ],
        onChange: form.setModel,
      }}
      effort={{
        value: form.effort,
        shown: form.effort || form.defaultEffort,
        options: [
          { value: "", label: `Project default · ${form.defaultEffort}` },
          ...EFFORTS.map((e) => ({ value: e, label: cap(e) })),
        ],
        onChange: form.setEffort,
      }}
    />
  );
}
