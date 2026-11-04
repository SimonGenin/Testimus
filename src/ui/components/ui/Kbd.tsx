import * as stylex from "@stylexjs/stylex";
import { border, color, fontFamily, fontSize, radius, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  kbd: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size.kbd,
    height: size.kbd,
    paddingBlock: 0,
    paddingInline: space.s2,
    borderStyle: "solid",
    borderColor: color.border,
    borderWidth: border.width,
    borderRadius: radius.r1,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.caption,
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  // inside a control (a button, a tooltip) it is a tinted pill in the control's colour
  onFill: {
    backgroundColor: "color-mix(in srgb, currentColor 12%, transparent)",
    color: "inherit",
    borderColor: "transparent",
    opacity: 0.85,
  },
});

export type KbdProps = {
  /** the keys, as shown: « Ctrl K », « V » */
  children: string;
  /** inside a control (a button, a tooltip): a tinted pill in the control's colour */
  onFill?: boolean;
};

export function Kbd({ children, onFill = false }: KbdProps) {
  return <kbd {...stylex.props(styles.kbd, onFill && styles.onFill)}>{children}</kbd>;
}
