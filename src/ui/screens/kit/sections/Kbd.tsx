import { Button } from "../../../components/ui/Button.tsx";
import { Kbd } from "../../../components/ui/Kbd.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Kbd",
  family: "Actions",
  file: "Kbd.tsx",
  summary:
    "A shortcut shown as keys: Ctrl K for the palette, Ctrl J for the dock, Ctrl+Enter to send, V to validate. On its own it is a sunken key; inside a control it is a pill tinted with the control's colour.",
  states: () => (
    <States>
      <Cell label="keys">
        <Kbd>Ctrl K</Kbd>
        <Kbd>Ctrl+Enter</Kbd>
        <Kbd>V</Kbd>
        <Kbd>J</Kbd>
      </Cell>
      <Cell label="onFill (inside a button)">
        <Button variant="primary" label="Validate" shortcut="V" />
        <Button label="To fix" shortcut="F" />
      </Cell>
    </States>
  ),
};
