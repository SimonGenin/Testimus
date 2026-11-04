import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Skeleton",
  family: "Feedback",
  file: "Skeleton.tsx",
  summary:
    "The shape of what is loading, drawn at the size of the content it stands for, so nothing moves when it lands. Never stale rows, never a centred spinner; after 10 s it says so and offers Retry.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="text · title" column>
        <Skeleton kind="title" width="50%" />
        <Skeleton width="80%" />
      </Cell>
      <Cell label="lines (the last shorter)" column>
        <Skeleton lines={3} />
      </Cell>
      <Cell label="block · circle" column>
        <Skeleton kind="block" />
        <Skeleton kind="circle" />
      </Cell>
      <Cell label="row (a List's loading row)" column>
        <Skeleton kind="row" />
        <Skeleton kind="row" />
      </Cell>
    </States>
  ),
};
