import { Tile } from "../../../components/ui/Tile.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Tile",
  family: "Collections",
  file: "Tile.tsx",
  summary:
    "A square that stands for a thing at the start of its row: a project's initials, a job's kind. Neutral for a job, accent for a project, violet for a Claude run.",
  note: "The rail's project avatar (shell.mjs .rail__avatar): the jobs list, the activity popover and the known projects each drew one.",
  states: () => (
    <States>
      <Cell label="initials · accent">
        <Tile initials="RS" tone="accent" />
        <Tile initials="LF" tone="accent" size="lg" />
      </Cell>
      <Cell label="icon · neutral · claude">
        <Tile icon="documents" />
        <Tile icon="claude" tone="claude" />
      </Cell>
      <Cell label="sizes sm · md · lg">
        <Tile icon="sync" size="sm" />
        <Tile icon="sync" />
        <Tile icon="sync" size="lg" />
      </Cell>
    </States>
  ),
};
