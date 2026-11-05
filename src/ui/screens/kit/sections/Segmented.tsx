import { Segmented } from "../../../components/ui/Segmented.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};
const THEME = [
  { value: "system", label: "System", icon: "monitor" as const },
  { value: "light", label: "Light", icon: "sun" as const },
  { value: "dark", label: "Dark", icon: "moon" as const },
];
const FILTER = [
  { value: "all", label: "All", count: 12 },
  { value: "draft", label: "Draft", count: 4 },
  { value: "fix", label: "To fix", count: 3 },
];

export const section: KitSection = {
  name: "Segmented",
  family: "Inputs",
  file: "Segmented.tsx",
  summary:
    "One of two to five views or modes, all visible (step layout, theme, the review filter, a column's fold): a radiogroup the arrows move through. Options are short nouns; a choice that starts an action is buttons.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="md · with icons" wide>
        <Segmented label="Theme" value="light" options={THEME} onChange={noop} />
      </Cell>
      <Cell label="sm · counts" wide>
        <Segmented label="Review filter" size="sm" value="all" options={FILTER} onChange={noop} />
      </Cell>
      <Cell label="fill: the container's width" wide column>
        <Segmented label="Review filter, full width" size="sm" fill value="all" options={FILTER} onChange={noop} />
      </Cell>
      <Cell label="icon only (tooltip)">
        <Segmented
          label="Step layout"
          value="stacked"
          options={[
            { value: "stacked", label: "Stacked", icon: "layout-stacked", iconOnly: true },
            { value: "split", label: "Action | Expected", icon: "layout-split", iconOnly: true },
          ]}
          onChange={noop}
        />
      </Cell>
      <Cell label="hover · focus" wide>
        <Segmented
          label="Fold"
          value="open"
          options={[
            { value: "open", label: "Open" },
            { value: "filled", label: "When filled" },
            { value: "collapsed", label: "Collapsed" },
          ]}
          onChange={noop}
          debugState={{ value: "filled", state: "hover" }}
        />
        <Segmented
          label="Scope"
          value="test"
          options={[
            { value: "test", label: "This test" },
            { value: "all", label: "All tests" },
          ]}
          onChange={noop}
          debugState={{ value: "test", state: "focus" }}
        />
      </Cell>
      <Cell label="disabled option with its reason" wide>
        <Segmented
          label="Jobs"
          value="all"
          options={[
            { value: "all", label: "All", count: 5 },
            { value: "running", label: "Running", count: 0, disabled: "Nothing is running" },
            { value: "failed", label: "Failed", count: 1 },
          ]}
          onChange={noop}
        />
      </Cell>
    </States>
  ),
};
