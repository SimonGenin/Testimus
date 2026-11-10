import * as stylex from "@stylexjs/stylex";
import { color } from "../../../styles/tokens.stylex.ts";

// ponytail: the two tones of a cited range, shared by the timeline and its legend — the range in the accent, the
// margins played around it in a paler accent (accent-subtle is too pale to tell from the bare track)
export const tones = stylex.create({
  cited: { backgroundColor: color.accent },
  margin: { backgroundColor: `color-mix(in srgb, ${color.accent} 30%, ${color.surface})` },
});
