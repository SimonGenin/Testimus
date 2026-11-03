import * as stylex from "@stylexjs/stylex";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  screen: {
    padding: space.s4,
    backgroundColor: color.surface,
    color: color.text,
  },
  probe: {
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderWidth: 0,
    borderRadius: radius.r2,
    backgroundColor: color.accent,
    color: color.onAccent,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
  },
});

export function KitScreen() {
  return (
    <section aria-label="Component kit" {...stylex.props(styles.screen)}>
      <h1>Kit</h1>
      <button type="button" {...stylex.props(styles.probe)}>
        StyleX probe
      </button>
    </section>
  );
}
