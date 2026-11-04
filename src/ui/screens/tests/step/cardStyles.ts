import * as stylex from "@stylexjs/stylex";
import { border, color, focus, radius, shadow, size, space } from "../../../styles/tokens.stylex.ts";

// the frame of a step card, shared by the live card and the placeholder of a deleted step
export const cardStyles = stylex.create({
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
  },
  head: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    minHeight: `calc(${size.controlMd} + ${space.s5})`,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s4,
  },
  focused: {
    outlineStyle: "solid",
    outlineWidth: border.widthStrong,
    outlineColor: color.focusRing,
    outlineOffset: focus.offset,
  },
});
