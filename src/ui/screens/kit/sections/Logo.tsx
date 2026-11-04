import { Logo } from "../../../components/ui/Logo.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Logo",
  family: "Foundations",
  file: "Logo.tsx",
  summary:
    "The Testimus logo on its light tile, white in both themes: the top of the rail and the first-launch screen. No other brand mark in the app.",
  note: "The rail and the first-launch screen drew it differently (a shadowed 40 px tile, a bare image); the design has one 32 px tile.",
  states: () => (
    <States>
      <Cell label="the tile (read out in the rail)">
        <Logo label="Testimus" />
      </Cell>
    </States>
  ),
};
