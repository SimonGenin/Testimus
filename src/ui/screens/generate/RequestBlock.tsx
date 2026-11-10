import { cap, EFFORTS, MODELS } from "../../components/claude/ModelPicker.tsx";
import { useRunContext } from "../../components/claude/useRunContext.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import type { GenerateForm } from "./useGenerateForm.ts";

// ponytail: the request is the Claude block — what goes with it (Context: the documents in scope, the saved contexts),
// model and effort in it; the Generate button lives in the form's foot, Ctrl+Enter here presses it
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
  const ctx = useRunContext({
    use: "generate",
    docs: form.scope.docs,
    sections: form.scope.sections,
    note: form.request,
    draftKey: form.contextKey,
    onSaved: () => form.setRequest(""),
  });

  const known = form.model && !MODELS.includes(form.model) ? [form.model] : [];
  const fallbackModel = MODELS.includes(form.defaultModel) ? [] : [form.defaultModel];

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
        context={ctx.context}
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
      {ctx.dialog}
    </>
  );
}
