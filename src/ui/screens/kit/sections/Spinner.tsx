import { Spinner } from "../../../components/ui/Spinner.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Spinner",
  family: "Feedback",
  file: "Spinner.tsx",
  summary:
    "Work going on, at the size of the icon it replaces, in the colour of the words beside it: a button that loads, a badge that runs, Saving…. Never a centred spinner for a whole pane (that is a Skeleton).",
  states: () => (
    <States>
      <Cell label="sm · md">
        <Spinner size="sm" />
        <Spinner />
      </Cell>
      <Cell label="alone, read out">
        <Spinner label="Loading the models" />
      </Cell>
    </States>
  ),
};
