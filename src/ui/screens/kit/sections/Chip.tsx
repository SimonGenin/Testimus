import { Chip } from "../../../components/ui/Chip.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Chip",
  family: "Inputs",
  file: "Chip.tsx",
  summary:
    "A small value you press or remove: a toggle (quick asks, a run's contexts, filters) or a value in a set (labels, covers, preconditions). Never a status (a Badge), never a main action (a Button).",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="toggle off · on · hover">
        <Chip label="Has findings" pressed={false} onToggle={() => {}} />
        <Chip label="To fix" pressed onToggle={() => {}} icon="to-fix" />
        <Chip label="Hovered" pressed={false} onToggle={() => {}} debugState="hover" />
      </Cell>
      <Cell label="claude tone · switched off for this run">
        <Chip label="Glossaire RATP" tone="claude" icon="context" pressed onToggle={() => {}} />
        <Chip label="Ancien lot" tone="claude" icon="context" pressed={false} strikeOff onToggle={() => {}} />
      </Cell>
      <Cell label="warning tone · a state to notice">
        <Chip label="Jira version" tone="warning" icon="clock" pressed={false} onToggle={() => {}} />
        <Chip label="Hide Jira version" tone="warning" icon="clock" pressed onToggle={() => {}} />
      </Cell>
      <Cell label="removable · mono · square">
        <Chip label="testimus-validated" onRemove={() => {}} />
        <Chip label="LFRPS12-1420" mono onRemove={() => {}} />
        <Chip label="EXI_MOP_SPF_511_A_1670" mono square onRemove={() => {}} />
      </Cell>
      <Cell label="disabled">
        <Chip label="Claude is working" tone="claude" pressed onToggle={() => {}} disabled />
        <Chip label="Locked" onRemove={() => {}} disabled />
      </Cell>
    </States>
  ),
};
