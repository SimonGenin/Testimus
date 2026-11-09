import * as stylex from "@stylexjs/stylex";
import { LIMITS, sectionCount, sectionOf } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { color, radius, space } from "../../../styles/tokens.stylex.ts";
import { Button } from "../Button.tsx";
import { Menu } from "../Menu.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  group: {
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    padding: space.inset,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  count: { paddingInline: space.s3, color: color.textMuted, whiteSpace: "nowrap" },
  number: { color: color.text },
});

// ponytail: the top bar's hold on the screen's sections — how many of the most it may have, a column added on the
// right, the section in use split in two, the screen's own layout back; a button that would break a limit is greyed
// and says which
export function SectionControls({ ws }: { ws: WorkspaceController }) {
  const n = sectionCount(ws.layout);
  const at = ws.focused ?? sectionOf(ws.layout, ws.tabs.find((t) => t.main)?.id ?? "")?.id;
  const split = at ? ws.addRefusal({ split: at }) : "Click a section first";
  const column = ws.addRefusal("column");
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar's group of controls, not a form's fieldset
    <div role="group" aria-label={`Sections of ${ws.label}`} {...stylex.props(styles.group)}>
      <span {...stylex.props(type.small, styles.count)}>
        Sections{" "}
        <span {...stylex.props(type.mono, type.strong, styles.number)}>
          {n}/{LIMITS.max}
        </span>
      </span>
      <Button
        variant="quiet"
        size="sm"
        icon="layout-split"
        label="Add column"
        disabled={column ?? false}
        onClick={() => ws.add("column")}
      />
      <Button
        variant="quiet"
        size="sm"
        icon="layout-stacked"
        label="Split"
        disabled={split ?? false}
        onClick={() => at && ws.add({ split: at })}
      />
      <Menu
        label="Layout"
        align="end"
        entries={[
          {
            label: "Add a column on the right",
            shortcut: "Ctrl Alt →",
            disabled: column ?? false,
            onSelect: () => ws.add("column"),
          },
          {
            label: "Split the section in use",
            shortcut: "Ctrl Alt ↓",
            disabled: split ?? false,
            onSelect: () => at && ws.add({ split: at }),
          },
          "separator",
          { label: `Reset the layout of ${ws.label}`, onSelect: ws.reset },
        ]}
        trigger={<Button variant="quiet" size="sm" icon="more" iconOnly label="Layout menu" />}
      />
    </div>
  );
}
