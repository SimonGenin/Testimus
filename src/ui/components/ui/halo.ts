import * as stylex from "@stylexjs/stylex";
import { border, color, focus, shadow } from "../../styles/tokens.stylex.ts";

// ponytail: the soft halo around a field's 1 px edge (SYSTEM.md « Focus and keyboard ») — the accent for a focused
// field, danger for a field in error, violet for the Claude block; written once here (kit.css .text, .select,
// .chipfield, .cblock). The mixes are kit.css's own (18 %, 14 %, 16 %): tokens.css has no halo token yet
const FOCUS = `0 0 0 ${border.width} ${color.focusRing}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.focusRing} 18%, transparent)`;
const INVALID = `0 0 0 ${border.width} ${color.danger}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.danger} 14%, transparent)`;
const CLAUDE = `0 0 0 ${border.width} ${color.claude}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.claude} 16%, transparent)`;

export const halo = stylex.create({
  /** a frame around a field: the halo while the field inside has the focus (Text, ChipField) */
  within: { boxShadow: { default: null, ":focus-within": FOCUS } },
  /** a control that is the field itself (Select): the halo on keyboard focus */
  visible: { boxShadow: { default: null, ":focus-visible": FOCUS } },
  /** the halo shown without the focus (the catalogue's focus state) */
  shown: { boxShadow: FOCUS },
  /** a field in error */
  invalid: { boxShadow: INVALID },
  /** the Claude block: its resting shadow, the violet halo while its text has the focus */
  claudeWithin: { boxShadow: { default: shadow.s1, ":focus-within": CLAUDE } },
  claudeShown: { boxShadow: CLAUDE },
});
