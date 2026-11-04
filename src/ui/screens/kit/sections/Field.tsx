import { useId } from "react";
import { Field } from "../../../components/ui/Field.tsx";
import { SaveState } from "../../../components/ui/SaveState.tsx";
import { Segmented } from "../../../components/ui/Segmented.tsx";
import { Select } from "../../../components/ui/Select.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const SCOPES = [
  { value: "test", label: "This test" },
  { value: "all", label: "All tests" },
];
const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
];

function Effort() {
  const id = useId();
  return (
    <Field label="Effort" htmlFor={id} state={<SaveState status="saved" />}>
      <Select id={id} label="Effort" value="medium" options={EFFORTS} onChange={() => {}} />
    </Field>
  );
}

export const section: KitSection = {
  name: "Field",
  family: "Inputs",
  file: "Field.tsx",
  summary:
    "The frame of a labelled control: its label (with the save state at its right), the control, the error, the hint. Text and Select draw their label through it; a screen wraps any other control in it.",
  note: "A wrapper, not a control: it was redrawn by Text, by Select (in another size and colour) and by Settings (`Labelled`, `Hint`); one frame now gives every field the same label, gap and hint.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Label (13 px medium, in the text colour) with the save state at its right · the control · optional error line (danger, with its icon) · optional hint (12 px, subtle).",
    },
    {
      head: "Rules",
      text: "Give `htmlFor` the control's id so the label names it; without it the label is for the eye only and the control names itself (a Segmented, a radio group). Point the control's `aria-describedby` at `errorId` and `hintId`.",
    },
  ],
  states: () => (
    <States>
      <Cell label="label · control · hint" column>
        <Field label="Scope" hint="Saved in this test only.">
          <Segmented label="Scope" value="test" options={SCOPES} onChange={() => {}} />
        </Field>
      </Cell>
      <Cell label="label for a control · save state" column>
        <Effort />
      </Cell>
      <Cell label="error" column>
        <Field label="Models folder" error="Use an absolute path" hint="Where the search models are kept.">
          <Select label="Models folder" value={null} options={EFFORTS} onChange={() => {}} block />
        </Field>
      </Cell>
    </States>
  ),
};
