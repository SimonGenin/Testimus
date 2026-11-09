import { useState } from "react";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { cap, EFFORTS, MODELS } from "../../components/claude/ModelPicker.tsx";
import { SaveContext } from "../../components/claude/SaveContext.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
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
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;

  const known = form.model && !MODELS.includes(form.model) ? [form.model] : [];
  const fallbackModel = MODELS.includes(form.defaultModel) ? [] : [form.defaultModel];
  const add: MenuEntry[] = [
    ...all
      .filter((c) => !form.chips.some((x) => x.id === c.id))
      .map((c) => ({
        label: c.name,
        icon: "context" as const,
        hint: c.shared ? "shared" : undefined,
        onSelect: () => form.setChips([...form.chips, { id: c.id, on: true }]),
      })),
    ...(all.length ? (["separator"] as MenuEntry[]) : []),
    {
      label: "Save the request as a context…",
      disabled: form.request.trim() ? false : "Write a request first",
      onSelect: () => setDialog("save"),
    },
    { label: "Manage contexts…", onSelect: () => setDialog("manage") },
  ];

  return (
    <>
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
        onContext={(id, on) => form.setChips(form.chips.map((c) => (c.id === id ? { id, on } : c)))}
        addContext={
          <Menu
            label="Add context"
            entries={add}
            trigger={<Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" disabled={readOnly} />}
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

      {dialog === "save" && (
        <SaveContext
          note={form.request}
          onSaved={(id) => {
            form.setChips([...form.chips, { id, on: true }]);
            form.setRequest("");
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
