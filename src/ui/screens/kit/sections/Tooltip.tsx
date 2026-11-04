import * as stylex from "@stylexjs/stylex";
import { Badge, SYNC } from "../../../components/ui/Badge.tsx";
import { Kbd } from "../../../components/ui/Kbd.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import { space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({ room: { display: "inline-block", paddingBlock: space.s8, paddingInline: space.s10 } });

export const section: KitSection = {
  name: "Tooltip",
  family: "Overlays",
  file: "Tooltip.tsx",
  summary:
    "The name of an icon button, a shortcut, the reason a control is disabled, a truncated title in full. Shown on hover after 500 ms and at once on keyboard focus; never interactive, never the only place for what is needed to act.",
  states: () => (
    <States>
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <Cell key={side} label={`side ${side}`}>
          <span {...stylex.props(styles.room)}>
            <Tooltip label="Same as Jira since 09:15" side={side} debugState="open">
              <span>
                <Badge {...SYNC["in-sync"]} />
              </span>
            </Tooltip>
          </span>
        </Cell>
      ))}
      <Cell label="with a shortcut">
        <span {...stylex.props(styles.room)}>
          <Tooltip label="Open the palette" shortcut="Ctrl K" debugState="open">
            <span>
              <Kbd>Ctrl K</Kbd>
            </span>
          </Tooltip>
        </span>
      </Cell>
    </States>
  ),
};
