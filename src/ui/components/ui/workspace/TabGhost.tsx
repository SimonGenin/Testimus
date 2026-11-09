import * as stylex from "@stylexjs/stylex";
import { createPortal } from "react-dom";
import { border, color, radius, shadow, size, space, z } from "../../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../Icon.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  ghost: {
    position: "fixed",
    zIndex: z.tooltip,
    display: "inline-flex",
    alignItems: "center",
    gap: space.snug,
    height: size.controlMd,
    paddingInline: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    borderRadius: radius.r2,
    backgroundColor: color.surface,
    color: color.text,
    boxShadow: shadow.s2,
    pointerEvents: "none",
    transform: `translate(${space.s4}, ${space.s3}) rotate(-2deg)`,
    whiteSpace: "nowrap",
  },
  claude: { color: color.claudeText },
  at: (x: string, y: string) => ({ left: x, top: y }),
});

// ponytail: the tab being dragged, under the pointer (the page reads what is beneath it, so it takes no pointer)
export function TabGhost({
  x,
  y,
  label,
  icon,
  claude,
}: {
  x: number;
  y: number;
  label: string;
  icon: IconName;
  claude?: boolean;
}) {
  return createPortal(
    <span
      aria-hidden="true"
      {...stylex.props(type.compact, type.medium, styles.ghost, claude && styles.claude, styles.at(`${x}px`, `${y}px`))}
    >
      <Icon name="grip" size="sm" />
      <Icon name={icon} />
      {label}
    </span>,
    document.body,
  );
}
