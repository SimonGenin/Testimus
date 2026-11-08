import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Loading",
  family: "Feedback",
  file: "Loading.tsx",
  summary:
    "The sign of life under a skeleton. For a second the shimmer is enough; then a line says what loads — in the words of the read it stands for — and the seconds, counting; from 10 s it says Testimus is answering slowly and offers Try again, which asks the read again. One line per read on the page. An error stays the screen's danger banner.",
  guidelines: [
    {
      head: "Use",
      items: [
        "Under the skeleton of a pane, a list (List `reading`) or a dialog, with the read the skeleton waits on.",
        "The words come from the read (`lib/data/loading.ts`), never from the screen.",
      ],
    },
  ],
  states: () => (
    <States>
      <Cell label="0 – 1 s: the skeleton alone" column>
        <Skeleton kind="title" width="50%" />
        <Skeleton lines={3} />
      </Cell>
      <Cell label="after 1 s: what loads, the seconds" column>
        <Skeleton kind="title" width="50%" />
        <Skeleton lines={2} />
        <Loading read="tests.list" debugState="status" />
      </Cell>
      <Cell label="after 10 s: answering slowly · Try again" wide column>
        <Skeleton kind="title" width="50%" />
        <Skeleton />
        <Loading read="tests.list" debugState="slow" />
      </Cell>
    </States>
  ),
};
