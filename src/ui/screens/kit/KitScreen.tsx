import * as stylex from "@stylexjs/stylex";
import { colors, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  screen: {
    padding: space.s3,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  probe: {
    paddingBlock: space.s1,
    paddingInline: space.s3,
    border: "none",
    borderRadius: radius.r2,
    backgroundColor: colors.accent,
    color: colors.accentText,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
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
