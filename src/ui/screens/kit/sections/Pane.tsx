import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Pane } from "../../../components/ui/Pane.tsx";
import { Segmented } from "../../../components/ui/Segmented.tsx";
import { type } from "../../../components/ui/type.ts";
import { size, space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  frame: { display: "flex", height: size.sidebar, width: "100%", minWidth: 0 },
  body: { padding: space.s6 },
});

const SHOW = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
];

export const section: KitSection = {
  name: "Pane",
  family: "Layout",
  file: "Pane.tsx",
  summary:
    "A pane of a screen: the documents list, a reader, the review queue and its source, the jobs list, Generate's request. A head as tall as the top bar with its title, tools and buttons, a body that scrolls, an optional foot.",
  note: "The shell's .pane (shell.mjs): eight screens drew their pane head with their own padding and gap.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Head: at least `size-topbar` high, 24 px sides, a hairline under it · the title in `titleSm` · tools after it (a count, a filter, a choice) · the buttons at the right end · the body scrolls · a foot under a hairline holds the pane's main action.",
    },
    {
      head: "Options",
      text: "`as` section or aside · `canvas` (the canvas ground, cards sit on it) · `fill` (takes the room left) · `scroll={false}` when what it holds scrolls by itself.",
    },
  ],
  states: () => (
    <States>
      <Cell label="title · count · actions · body" wide column>
        <div {...stylex.props(styles.frame)}>
          <Pane
            as="aside"
            fill
            title="Documents"
            tools={<Badge label="3" count />}
            actions={<Button size="sm" variant="quiet" icon="close" iconOnly label="Close the list" />}
          >
            <div {...stylex.props(type.compact, styles.body)}>SOSIE_211_D401-1_3 · Spécification IHM poste</div>
          </Pane>
        </div>
      </Cell>
      <Cell label="tools only · canvas · foot" wide column>
        <div {...stylex.props(styles.frame)}>
          <Pane
            label="Jobs"
            canvas
            fill
            tools={<Segmented size="sm" label="Show jobs" value="all" options={SHOW} onChange={() => {}} />}
            actions={<Button size="sm" variant="quiet" icon="trash" label="Clear finished" />}
            footer={<Button variant="primary" label="Generate" icon="generate" />}
          >
            <div {...stylex.props(type.compact, styles.body)}>Long work runs here.</div>
          </Pane>
        </div>
      </Cell>
    </States>
  ),
};
