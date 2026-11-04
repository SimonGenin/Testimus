import { Timer } from "../../../components/ui/Timer.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Timer",
  family: "Claude",
  file: "Timer.tsx",
  summary:
    "The seconds counter of running work: mono, tabular figures, violet for a Claude run (the Claude block's footer, Generate's running card), muted for any other job.",
  note: "The design's .timer: the Claude block and Generate each drew their own.",
  states: () => (
    <States>
      <Cell label="claude · under a minute · past an hour">
        <Timer seconds={12} />
        <Timer seconds={3725} />
      </Cell>
      <Cell label="quiet (another job)">
        <Timer seconds={95} tone="quiet" />
      </Cell>
    </States>
  ),
};
