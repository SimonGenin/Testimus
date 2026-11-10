import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { type } from "../../../components/ui/type.ts";
import { DropZones } from "../../../components/ui/workspace/DropZones.tsx";
import { SectionControls } from "../../../components/ui/workspace/SectionControls.tsx";
import { Workspace } from "../../../components/ui/workspace/Workspace.tsx";
import { column, layoutOf, section as sec } from "../../../lib/workspace/layout.ts";
import { useWorkspace } from "../../../lib/workspace/useWorkspace.ts";
import { color, size, space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  frame: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    width: "100%",
    height: `calc(3 * ${size.thumbLarge})`,
  },
  body: { padding: space.s4, color: color.textMuted },
  zones: {
    position: "relative",
    width: "100%",
    height: `calc(2 * ${size.thumbLarge})`,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
});

const text = (t: string): ReactNode => <p {...stylex.props(type.compact, styles.body)}>{t}</p>;

function Demo() {
  const ws = useWorkspace({
    pref: "layoutKit",
    label: "Kit",
    defaults: layoutOf(
      column(200, sec(["queue"])),
      column(null, sec(["test"])),
      column(260, sec(["source", "claude"]), sec(["found"], true)),
    ),
    tabs: [
      { id: "queue", label: "Queue", icon: "list", count: 2, content: text("The list moved through with J / K.") },
      {
        id: "test",
        label: "Test",
        icon: "tests",
        main: true,
        content: text("The work: its column takes the room left and folds last."),
        footer: text("A tab's foot: 48 px, at the bottom, always in view"),
      },
      { id: "source", label: "Source", icon: "quote", content: text("Drag a tab by its grip to another section.") },
      { id: "claude", label: "Claude", icon: "claude", claude: true, dot: "claude", content: text("Claude's tab") },
      {
        id: "found",
        label: "Findings",
        icon: "alert-triangle",
        count: 3,
        content: text("A section of a split column"),
      },
    ],
  });
  return (
    <div {...stylex.props(styles.frame)}>
      <SectionControls ws={ws} />
      <Workspace ws={ws} />
    </div>
  );
}

export const section: KitSection = {
  name: "Workspace",
  family: "Layout",
  file: "workspace/Workspace.tsx",
  summary:
    "A screen's sections: 2 to 4, in columns, at most 2 per column; each holds tabs, each tab its icon, its content and its 48 px foot. A tab is dragged by its grip to another section (its bar, its middle, or an edge to split or open a column), or sent with Alt Shift and an arrow or the section's menu; a section folds to its strip of icons or its bar; the top bar's Sections controls add a column, split the section in use or reset. The layout is kept per screen in lib/prefs.",
  note: "New: a screen arranged by the user, which no Pane option nor split could hold.",
  guidelines: [
    {
      head: "Rules",
      items: [
        "Every tab has an icon: a collapsed section is read from its icons.",
        "A section whose last tab leaves goes; with 2 sections left, a last tab cannot leave.",
        "A screen with one thing to show keeps 2 sections, the second collapsed.",
        "A narrow window folds the rightmost columns to their strip; the work's and the one in use last, the one in use kept when both cannot fit.",
      ],
    },
  ],
  states: () => (
    <States>
      <Cell label="three columns, the last split, its bottom section collapsed (try it)" wide column>
        <Demo />
      </Cell>
      <Cell label="a tab dragged over a section: the bottom splits" column>
        <div {...stylex.props(styles.zones)}>
          <DropZones zone="below" marker={null} refused={null} />
        </div>
      </Cell>
      <Cell label="a full column: no split, the middle takes the tab" column>
        <div {...stylex.props(styles.zones)}>
          <DropZones zone="center" open={["left", "right"]} marker={null} refused={null} />
        </div>
      </Cell>
      <Cell label="refused: the reason in place of the zone" column>
        <div {...stylex.props(styles.zones)}>
          <DropZones zone="center" open={[]} marker={null} refused="2 sections at least" />
        </div>
      </Cell>
    </States>
  ),
};
