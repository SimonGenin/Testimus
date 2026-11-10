import * as stylex from "@stylexjs/stylex";
import { border, color, radius, space, z } from "../../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../Icon.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  over: {
    boxSizing: "border-box",
    position: "absolute",
    inset: 0,
    zIndex: z.sticky,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.s3,
    borderWidth: border.widthStrong,
    borderStyle: "dashed",
    borderColor: color.accent,
    borderRadius: radius.r3,
    backgroundColor: color.accentSubtle,
    opacity: 0.92,
    pointerEvents: "none",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingInline: space.s4,
    paddingBlock: space.s2,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    color: color.onAccent,
    textAlign: "center",
  },
});

// ponytail: what an edge dragged past a section's least size will do — the section (or the column) it would fold,
// covered and named, before the drag ends
export function FoldHint({ icon }: { icon: IconName }) {
  return (
    <div role="status" {...stylex.props(styles.over)}>
      <span {...stylex.props(type.small, type.medium, styles.label)}>
        <Icon name={icon} size="sm" />
        Release to collapse
      </span>
    </div>
  );
}
