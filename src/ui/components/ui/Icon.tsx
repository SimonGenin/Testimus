import * as stylex from "@stylexjs/stylex";
import { createElement } from "react";
import { size, space } from "../../styles/tokens.stylex.ts";
import { ICONS, type IconName } from "./icons.ts";
import { Spinner } from "./Spinner.tsx";

export type { IconName };

const styles = stylex.create({
  icon: {
    flex: "none",
    display: "inline-block",
    verticalAlign: "middle",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  xs: { width: space.s4, height: space.s4 },
  sm: { width: size.iconSm, height: size.iconSm },
  md: { width: size.iconMd, height: size.iconMd },
  lg: { width: size.iconLg, height: size.iconLg },
  bold: { strokeWidth: 2.25 },
});

export type IconProps = {
  name: IconName;
  /** xs 12 px (a checkbox's mark) · sm 14 px (badges, chips) · md 16 px (buttons, rows, menus; default) · lg 20 px
   * (rail, empty states) */
  size?: "xs" | "sm" | "md" | "lg";
  /** a heavier stroke, for a mark drawn small (the check of a checkbox) */
  bold?: boolean;
  /** an icon alone says something: its label is read out; beside a word it is decoration (no label) */
  label?: string;
};

// ponytail: the design's SVG set as data — each shape is rebuilt as an element, never injected as markup; « spinner »
// is never drawn still: it is the kit's turning Spinner, as the design draws work going on
export function Icon({ name, size: s = "md", label, bold = false }: IconProps) {
  if (name === "spinner") return <Spinner size={s === "xs" || s === "sm" ? "sm" : "md"} label={label} />;
  return (
    <svg
      viewBox="0 0 16 16"
      data-icon={name}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...stylex.props(styles.icon, styles[s], bold && styles.bold)}
    >
      {ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
