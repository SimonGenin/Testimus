import * as stylex from "@stylexjs/stylex";
import type { Section } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Button } from "../Button.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  pick: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
  },
  title: { margin: 0, color: color.text },
  note: { color: color.textMuted },
});

// ponytail: a section just added waits for its first tab: dropped here, or picked from this list (each tab of the
// screen, with the reason when taking it would break a limit)
export function SectionPicker({ ws, section }: { ws: WorkspaceController; section: Section }) {
  const elsewhere = ws.tabs.filter((t) => !section.tabs.includes(t.id));
  return (
    <div {...stylex.props(styles.pick)}>
      <p {...stylex.props(type.body, type.strong, styles.title)}>Drag a tab here, or move one:</p>
      {elsewhere.map((t) => {
        const to = { kind: "tabs", section: section.id, index: 0 } as const;
        return (
          <Button
            key={t.id}
            icon={t.icon}
            label={t.label}
            block="start"
            disabled={ws.refusal(t.id, to) ?? false}
            onClick={() => ws.move(t.id, to)}
          />
        );
      })}
      <p {...stylex.props(type.small, styles.note)}>Esc, or a click elsewhere: this empty section goes away.</p>
    </div>
  );
}
