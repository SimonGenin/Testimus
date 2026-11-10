import * as stylex from "@stylexjs/stylex";
import { color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { held, type Piece, tokens } from "./pieces.ts";

const styles = stylex.create({
  bar: {
    flex: 1,
    display: "flex",
    gap: space.s1,
    minWidth: size.menuMin,
    height: size.dot,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.surfaceSunken,
  },
  part: { minWidth: space.inset, height: "100%" },
  said: { backgroundColor: color.claude },
  loaded: { backgroundColor: color.claudeBorder },
  context: { backgroundColor: color.accent },
  picked: { outlineStyle: "solid", outlineWidth: space.s1, outlineColor: color.text, outlineOffset: `-${space.s1}` },
});

// ponytail: where the tokens Claude starts with come from, one part per piece as wide as it weighs — the saved contexts
// in the accent, what is said in Claude's colour, what Claude Code loads lighter; the piece shown beside is outlined.
// Decoration: the words are in the list and the total
export function GivenBar({ pieces, picked }: { pieces: Piece[]; picked?: string | null }) {
  return (
    <div aria-hidden="true" {...stylex.props(styles.bar)}>
      {held(pieces)
        .filter((p) => p.chars > 0)
        .map((p) => (
          <span
            key={p.id}
            title={`${p.name} · ${tokens(p.chars)}`}
            style={{ flexGrow: p.chars }}
            {...stylex.props(
              styles.part,
              p.kind === "context" ? styles.context : p.how === "inline" ? styles.said : styles.loaded,
              p.id === picked && styles.picked,
            )}
          />
        ))}
    </div>
  );
}
