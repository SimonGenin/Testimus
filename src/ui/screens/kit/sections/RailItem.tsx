import { RailItem } from "../../../components/ui/RailItem.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "RailItem",
  family: "Navigation",
  file: "RailItem.tsx",
  summary:
    "A destination of the left rail: an icon over a short word, a pill of how many wait, the screen shown now raised. The project is its avatar, the system state its dot.",
  note: "New component, not a Button option: an icon over a word in a 56 px column, a count pill and a raised current state resemble no other control.",
  states: () => (
    <States>
      <Cell label="default · current · hover · focus">
        <RailItem icon="documents" label="Documents" />
        <RailItem icon="tests" label="Tests" current />
        <RailItem icon="generate" label="Generate" debugState="hover" />
        <RailItem icon="jobs" label="Jobs" debugState="focus" />
      </Cell>
      <Cell label="with a count · as a link">
        <RailItem icon="review" label="Review" count={3} href="#/kit/RailItem" />
        <RailItem icon="jobs" label="Jobs" count={12} />
      </Cell>
      <Cell label="project avatar · system dot · theme">
        <RailItem avatar="RS" label="LFRPS12" mono ariaLabel="Project LFRPS12, change project" />
        <RailItem dot="success" label="All good" ariaLabel="System: All good. Open the system check" />
        <RailItem dot="warning" label="1 to check" ariaLabel="System: 1 to check. Open the system check" />
        <RailItem icon="sun" label="System" ariaLabel="Theme: System. Switch to Light" />
      </Cell>
    </States>
  ),
};
