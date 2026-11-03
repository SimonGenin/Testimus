import { Progress } from "../../../components/ui/Progress.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Progress",
  family: "Status",
  file: "Progress.tsx",
  summary:
    "A 4 px bar for a job with a known amount of work (index, downloads, pulls); indeterminate when the end is unknown. The words under it say what and how much.",
  note: "Added to the N2 list on purpose: nine bars were drawn by hand under five names, and only five said they were a progress bar.",
  states: () => (
    <States>
      <Cell label="0 · partial · done" column>
        <Progress label="Index" value={0} />
        <Progress label="Index" value={40} detail="12 / 40 sections · 1 min left" />
        <Progress label="Index" value={100} tone="success" detail="40 / 40 sections" />
      </Cell>
      <Cell label="claude" column>
        <Progress label="Generate tests" value={72} tone="claude" detail="Writing test 5 of 7" />
      </Cell>
      <Cell label="indeterminate" column>
        <Progress label="Pull LFRPS12" detail="Reading the folders…" />
      </Cell>
    </States>
  ),
};
