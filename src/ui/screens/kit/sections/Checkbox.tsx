import { Checkbox } from "../../../components/ui/Checkbox.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};
const LONG =
  "Only the tests whose last check found an anomaly in a step that cites a passage changed since the previous conversion";

export const section: KitSection = {
  name: "Checkbox",
  family: "Inputs",
  file: "Checkbox.tsx",
  summary:
    "A yes/no submitted with a form or a filter (« Only with findings », « Shared with every project »); radio is its option for one of N inside a form (a RadioGroup). A setting that applies at once is a Switch.",
  states: () => (
    <States>
      <Cell label="off · on · mixed" column>
        <Checkbox checked={false} onChange={noop} label="Only with findings" />
        <Checkbox checked onChange={noop} label="Only with findings" />
        <Checkbox checked="mixed" onChange={noop} label="All folders" />
      </Cell>
      <Cell label="hover · focus" column>
        <Checkbox checked={false} onChange={noop} label="Only with findings" debugState="hover" />
        <Checkbox checked onChange={noop} label="Only with findings" debugState="focus" />
      </Cell>
      <Cell label="disabled · disabled with its reason" column>
        <Checkbox checked onChange={noop} label="Shared with every project" disabled />
        <Checkbox checked={false} onChange={noop} label="Keep the old version" disabled="Claude is not connected" />
      </Cell>
      <Cell label="hint" column>
        <Checkbox
          checked
          onChange={noop}
          label="Shared with every project"
          hint="Every project sees this context; unticked, it stays in LFRPS12."
        />
      </Cell>
      <Cell label="radio off · on · focus · disabled" column>
        <Checkbox radio checked onChange={noop} label="Move the models" hint="4.2 GB, about 2 minutes" />
        <Checkbox radio checked={false} onChange={noop} label="Keep them where they are" debugState="focus" />
        <Checkbox radio checked={false} onChange={noop} label="Copy them" disabled />
      </Cell>
      <Cell label="long label" column>
        <Checkbox checked={false} onChange={noop} label={LONG} />
      </Cell>
    </States>
  ),
};
