import { useState } from "react";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { cap, EFFORTS, MODELS } from "../../components/claude/ModelPicker.tsx";
import { SaveContext } from "../../components/claude/SaveContext.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useRead } from "../../lib/data/query.ts";
import type { GenerateForm } from "./useGenerateForm.ts";

const VALID = /^[A-Za-z0-9.\-[\]:]+$/;
const CUSTOM = "custom";

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
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState("");
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;

  const known = form.model && !MODELS.includes(form.model) ? [form.model] : [];
  const fallbackModel = MODELS.includes(form.defaultModel) ? [] : [form.defaultModel];
  const modelValue = typing ? CUSTOM : form.model;
  const commit = () => {
    const t = custom.trim();
    if (t && VALID.test(t)) {
      form.setModel(t);
      setTyping(false);
    }
  };
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
          value: modelValue,
          options: [
            { value: "", label: `Project default · ${cap(form.defaultModel)}` },
            ...[...fallbackModel, ...MODELS, ...known].map((m) => ({ value: m, label: cap(m) })),
            { value: CUSTOM, label: "Custom…" },
          ],
          onChange: (m) => {
            if (m === CUSTOM) {
              setCustom("");
              setTyping(true);
              return;
            }
            setTyping(false);
            form.setModel(m);
          },
        }}
        effort={{
          value: form.effort,
          options: [
            { value: "", label: `Project default · ${form.defaultEffort}` },
            ...EFFORTS.map((e) => ({ value: e, label: cap(e) })),
          ],
          onChange: form.setEffort,
        }}
      >
        {typing && (
          <Text
            size="sm"
            ariaLabel="Custom model"
            placeholder="Model id or alias"
            spellCheck={false}
            autoFocus
            value={custom}
            error={custom.trim() && !VALID.test(custom.trim()) ? "Letters, digits and . - [ ] : only" : undefined}
            onChange={setCustom}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
          />
        )}
      </ClaudeBlock>
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
