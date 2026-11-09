import { GroupSelect, type SelectGroup } from "../../../components/ui/GroupSelect.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const groups = (model: string, effort: string): SelectGroup[] => [
  {
    label: "Model",
    value: model,
    options: ["fable", "opus", "sonnet", "haiku"].map((m) => ({ value: m, label: m })),
    onChange: () => {},
  },
  {
    label: "Effort",
    value: effort,
    options: ["low", "medium", "high", "xhigh", "max"].map((e) => ({ value: e, label: e })),
    onChange: () => {},
  },
];

export const section: KitSection = {
  name: "GroupSelect",
  family: "Inputs",
  file: "GroupSelect.tsx",
  summary:
    "Several values chosen in one quiet select: model and effort are « opus · high » in the Claude block's foot, the conversion options and an action card.",
  note: "The Select's list is the platform's own and holds one value; model · effort are two values in one list, whose open list is the Menu (one group each, the chosen option checked).",
  guidelines: [
    {
      head: "Options",
      text: "One group per value (`Model`, `Effort`), in the order the field shows them joined by « · » · `prefix` (« Claude ») · leading icon (`cpu` by default) · `shown`, the field's word for a group whose option label is long (« Project default · Sonnet » shows « Sonnet »). **States.** default · hover · open (a Menu, each group with its checked option) · disabled (with the reason as tooltip). **Rules.** Only for values chosen together for one run; one value is a Select.",
    },
  ],
  states: () => (
    <States>
      <Cell label="closed · quiet sm · cpu">
        <GroupSelect label="Model and effort" groups={groups("opus", "high")} />
      </Cell>
      <Cell label="prefix">
        <GroupSelect label="Claude's model and effort" prefix="Claude" groups={groups("sonnet", "low")} />
      </Cell>
      <Cell label="disabled with its reason">
        <GroupSelect label="Model and effort" groups={groups("opus", "high")} disabled="Claude is not connected" />
      </Cell>
      <Cell label="open (the list is a Menu)" wide column>
        <GroupSelect label="Model and effort" groups={groups("opus", "high")} debugState="open" />
      </Cell>
    </States>
  ),
};
