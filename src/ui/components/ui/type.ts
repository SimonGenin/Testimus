import * as stylex from "@stylexjs/stylex";
import { color, fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } from "../../styles/tokens.stylex.ts";

// ponytail: the design's text styles (SYSTEM.md « Type », kit.css .t-*) — size, line, weight and the titles' tightening
// in one place; a screen composes them first, then its own layout: stylex.props(type.title, styles.head). No screen
// sets fontSize, fontWeight, lineHeight or letterSpacing itself
export const type = stylex.create({
  /** 12/16 medium, muted: column heads, list and menu group labels, the step number */
  caption: {
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.caption,
    color: color.textMuted,
  },
  /** 12/18: meta lines, badges, hints, timestamps */
  small: { fontSize: fontSize.small, lineHeight: lineHeight.small, letterSpacing: letterSpacing.small },
  /** 13/20: rows, menus, chips, tabs, buttons */
  compact: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, letterSpacing: letterSpacing.compact },
  /** 13/20 medium in the text colour: a field's label (Text, Select, Field) */
  label: {
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.compact,
    color: color.text,
  },
  /** 14/22: fields, step text, dialogs, dock messages */
  body: { fontSize: fontSize.body, lineHeight: lineHeight.body, letterSpacing: letterSpacing.body },
  /** 14/20 semibold: card titles, section heads, a pane's title */
  titleSm: {
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.titleSm,
  },
  /** 16/24 semibold: the test summary, dialog titles */
  title: {
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.title,
  },
  /** 22/30 semibold: screen titles */
  titleLg: {
    fontSize: fontSize.titleLg,
    lineHeight: lineHeight.titleLg,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.titleLg,
  },
  /** 32/40 semibold: first launch, splash */
  display: {
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.display,
  },
  /** 16/26 serif: document text and source passages */
  reading: {
    fontFamily: fontFamily.reading,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.reading,
    letterSpacing: letterSpacing.reading,
  },
  /** 18/26 serif semibold: a section title inside a passage or a document */
  readingHeading: {
    fontFamily: fontFamily.reading,
    fontSize: fontSize.readingHeading,
    lineHeight: lineHeight.readingHeading,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.readingHeading,
  },
  /** 12/18 mono: keys, anchors, ids, paths, raw output */
  code: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.code,
  },
  /** 10/12: the rail's project key and count pill (shell.mjs) */
  micro: { fontSize: fontSize.micro, lineHeight: lineHeight.micro, letterSpacing: letterSpacing.small },
  /** the weight alone, after a style: a word that stands out in a row */
  medium: { fontWeight: fontWeight.medium },
  /** the weight alone, after a style: a title inside a row or a banner */
  strong: { fontWeight: fontWeight.semibold },
  /** the weight alone, after a style: back to regular inside a bold head */
  regular: { fontWeight: fontWeight.regular },
  /** numbers that line up: counts, durations, percentages */
  tabular: { fontVariantNumeric: "tabular-nums" },
  /** the font of the interface, back from the reading or mono face (a UI word inside a passage) */
  ui: { fontFamily: fontFamily.ui },
  /** the mono face alone, at the size around it: an id, a path, a key inside a sentence */
  mono: { fontFamily: fontFamily.mono },
  /** the reading face alone, at the size around it: a query or a quote inside a UI line */
  readingFace: { fontFamily: fontFamily.reading },
});

export type TypeStyle = Exclude<
  keyof typeof type,
  "medium" | "strong" | "regular" | "tabular" | "ui" | "mono" | "readingFace"
>;

/** the styles a catalogue or a test walks, in the design's order */
export const TYPE_STYLES: TypeStyle[] = [
  "caption",
  "small",
  "compact",
  "label",
  "body",
  "titleSm",
  "title",
  "titleLg",
  "display",
  "reading",
  "readingHeading",
  "code",
  "micro",
];
