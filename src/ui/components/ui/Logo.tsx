import * as stylex from "@stylexjs/stylex";
import { border, color, radius, shadow, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  tile: {
    boxSizing: "border-box",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.logo,
    height: size.logo,
    padding: space.inset,
    borderRadius: radius.r2,
    backgroundColor: color.logoTile,
    boxShadow: `${shadow.s0}, 0 0 0 ${border.width} ${color.border}`,
  },
  img: { display: "block", width: "100%", height: "100%", objectFit: "contain" },
});

export type LogoProps = {
  /** read out when the logo is the only name of the app on screen (the rail); empty beside the word « Testimus » */
  label?: string;
};

// ponytail: the Testimus logo on its light tile, white in both themes (shell.mjs .rail__logo, SPEC §13) — the top of
// the rail and the first-launch screen; the one place it is drawn
export function Logo({ label = "" }: LogoProps) {
  return (
    <span {...stylex.props(styles.tile)}>
      <img src="/logo.png" alt={label} {...stylex.props(styles.img)} />
    </span>
  );
}
