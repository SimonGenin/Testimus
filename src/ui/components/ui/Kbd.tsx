import * as stylex from "@stylexjs/stylex";
import { border, color, fontFamily, fontSize, radius, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: size.kbd,
    height: size.kbd,
    paddingBlock: 0,
    paddingInline: space.s2,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    borderWidth: border.width,
    borderBottomWidth: border.widthStrong,
    borderRadius: radius.r1,
    backgroundColor: color.surface,
    color: color.textMuted,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.caption,
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  // inside a filled control (a button, a tooltip) it takes the control's colour
  onFill: {
    backgroundColor: "transparent",
    color: "inherit",
    borderColor: "currentColor",
    opacity: 0.7,
  },
});

export type KbdProps = {
  /** the keys, as shown: « Ctrl K », « V » */
  children: string;
  /** inside a filled control: transparent, in the control's colour */
  onFill?: boolean;
};

export function Kbd({ children, onFill = false }: KbdProps) {
  return <kbd {...stylex.props(styles.kbd, onFill && styles.onFill)}>{children}</kbd>;
}
