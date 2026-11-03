import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { ChipField } from "../../../components/ui/ChipField.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};
const LABELS = ["testimus-checked", "traction", "sectionneur", "ihm", "lot-2", "non-regression"];
const PRECONDITIONS = [
  { value: "LFRPS12-10", label: "Session ouverte" },
  { value: "LFRPS12-11", label: "Écran d'accueil affiché" },
  { value: "LFRPS12-12", label: "Droits administrateur" },
];

function Live() {
  const [values, setValues] = useState(["testimus-checked"]);
  return (
    <ChipField
      label="Labels"
      showLabel
      values={values}
      onChange={setValues}
      placeholder="Add a label…"
      suggest={(q) => LABELS.filter((l) => l.includes(q.toLowerCase()))}
    />
  );
}

export const section: KitSection = {
  name: "ChipField",
  family: "Inputs",
  file: "ChipField.tsx",
  summary:
    "The Text component with chips before the caret: Enter, a comma or leaving adds; Backspace in an empty box removes the last chip; suggestions open under the field. Labels, covers, preconditions, contexts.",
  note: "Built on Text (bare) and Chip (square, removable); the suggestions are a listbox under the box, the combobox pattern.",
  states: () => (
    <States>
      <Cell label="empty · label shown · suggestions (try it)" column>
        <Live />
      </Cell>
      <Cell label="filled" column>
        <ChipField
          label="Labels"
          values={["testimus-checked", "traction"]}
          onChange={noop}
          placeholder="Add a label…"
        />
      </Cell>
      <Cell label="hover · focus · mono" column>
        <ChipField label="Labels" values={["traction"]} onChange={noop} placeholder="Add a label…" debugState="hover" />
        <ChipField
          label="Covers"
          values={["LFRPS12-880"]}
          mono
          onChange={noop}
          placeholder="Add an issue key…"
          debugState="focus"
        />
      </Cell>
      <Cell label="choices · open" column>
        <ChipField
          label="Preconditions"
          values={["LFRPS12-10"]}
          choices={PRECONDITIONS}
          onChange={noop}
          placeholder="Attach a precondition…"
          debugState="open"
        />
      </Cell>
      <Cell label="inline · trailing" column>
        <ChipField
          label="Contexts"
          appearance="inline"
          values={["Glossaire RATP"]}
          onChange={noop}
          placeholder="Add a context…"
          trailing={<Button size="sm" variant="quiet" label="Browse…" />}
        />
      </Cell>
      <Cell label="read only · disabled" column>
        <ChipField label="Covers" values={["LFRPS12-880", "LFRPS12-881"]} mono />
        <ChipField label="Labels" values={["traction"]} onChange={noop} disabled placeholder="Add a label…" />
      </Cell>
      <Cell label="many and long values (wraps)" wide>
        <ChipField
          label="Labels"
          values={[
            "testimus-checked",
            "traction",
            "sectionneur-avec-telecommande-manoeuvre-reguliere",
            "ihm",
            "lot-2",
            "non-regression",
          ]}
          onChange={noop}
          placeholder="Add a label…"
        />
      </Cell>
    </States>
  ),
};
