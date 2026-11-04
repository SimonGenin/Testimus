import { Icon, type IconName } from "../../../components/ui/Icon.tsx";
import { ICONS } from "../../../components/ui/icons.ts";
import { Kbd } from "../../../components/ui/Kbd.tsx";
import { Spinner } from "../../../components/ui/Spinner.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Icon",
  family: "Foundations",
  file: "Icon.tsx",
  summary:
    "Testimus's own SVG set (design/icons), as data: 16 px grid, 1.5 stroke, currentColor. sm 14 px in badges and chips, md 16 px in buttons and rows, lg 20 px in the rail. With them, the spinner and the keys.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="sizes sm · md · lg">
        <Icon name="validated" size="sm" />
        <Icon name="validated" />
        <Icon name="validated" size="lg" />
      </Cell>
      <Cell label="spinner sm · md · keys">
        <Spinner size="sm" />
        <Spinner />
        <Kbd>Ctrl K</Kbd>
        <Kbd>V</Kbd>
      </Cell>
      <Cell label={`the set (${Object.keys(ICONS).length})`} wide>
        {(Object.keys(ICONS) as IconName[]).map((n) => (
          <Icon key={n} name={n} label={n} />
        ))}
      </Cell>
    </States>
  ),
};
