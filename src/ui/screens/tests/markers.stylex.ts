import * as stylex from "@stylexjs/stylex";

// ponytail: what reveals on hover or focus of which ancestor — a step card shows its grip and tools, a strip its
// buttons, a block its handle and ✕, a field hides its empty hint while it has the focus; each its own marker, so
// hovering a card does not open every strip inside it
export const stepMarker = stylex.defineMarker();
export const stripMarker = stylex.defineMarker();
export const blockMarker = stylex.defineMarker();
export const hintMarker = stylex.defineMarker();
