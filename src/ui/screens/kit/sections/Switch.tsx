import { Switch } from "../../../components/ui/Switch.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};

export const section: KitSection = {
  name: "Switch",
  family: "Inputs",
  file: "Switch.tsx",
  summary:
    "A setting that takes effect immediately (« Always on top », a smart column's « Claude fills it », a default context). Label on the right, describing the on state; never inside a form that has a Save button.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="off · on" column>
        <Switch on={false} onChange={noop} label="Always on top" />
        <Switch on onChange={noop} label="Always on top" />
      </Cell>
      <Cell label="focus" column>
        <Switch on onChange={noop} label="Claude fills it" debugState="focus" />
      </Cell>
      <Cell label="disabled off · on with its reason" column>
        <Switch on={false} onChange={noop} label="Always on top" disabled />
        <Switch on onChange={noop} label="Glossaire RATP" disabled="Claude is working — wait for it to finish" />
      </Cell>
      <Cell label="hint" column>
        <Switch on onChange={noop} label="Always on top" hint="Keeps the window above Jira and the specification." />
      </Cell>
      <Cell label="long label" column>
        <Switch
          on={false}
          onChange={noop}
          label="Adapt to the PC's load: fewer passages are read at once while another program needs the processor"
        />
      </Cell>
    </States>
  ),
};
