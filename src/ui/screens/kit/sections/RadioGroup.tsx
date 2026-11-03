import { RadioGroup } from "../../../components/ui/RadioGroup.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};
const FOLDER = [
  { value: "move", label: "Move the models", hint: "4.2 GB, about 2 minutes" },
  { value: "keep", label: "Keep them where they are", hint: "The new folder starts empty" },
  { value: "copy", label: "Copy them", disabled: "Not enough room on D: (3.1 GB free)" },
];

export const section: KitSection = {
  name: "RadioGroup",
  family: "Inputs",
  file: "RadioGroup.tsx",
  summary:
    "One of N inside a form (the models folder: Move / Keep / Copy): Checkbox radios sharing a name in a radiogroup, so the arrows move between them. Two to five visible views or modes are a Segmented choice.",
  note: "A wrapper of Checkbox (its radio option), not a new control: it only names the group and shares the name.",
  states: () => (
    <States>
      <Cell label="label shown · one chosen · hint · disabled with its reason" column>
        <RadioGroup label="Models folder" showLabel value="move" options={FOLDER} onChange={noop} />
      </Cell>
      <Cell label="nothing chosen · focus on one" column>
        <RadioGroup
          label="Models folder"
          value={null}
          options={FOLDER}
          onChange={noop}
          debugState={{ value: "keep", state: "focus" }}
        />
      </Cell>
      <Cell label="inline · hover on one">
        <RadioGroup
          label="Scope"
          inline
          value="test"
          options={[
            { value: "test", label: "This test" },
            { value: "all", label: "All tests" },
          ]}
          onChange={noop}
          debugState={{ value: "all", state: "hover" }}
        />
      </Cell>
      <Cell label="disabled as a whole" column>
        <RadioGroup label="Models folder" value="keep" options={FOLDER} onChange={noop} disabled="Downloading" />
      </Cell>
    </States>
  ),
};
