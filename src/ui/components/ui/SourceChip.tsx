import * as stylex from "@stylexjs/stylex";
import { border, color, fontFamily, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  chip: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    maxWidth: "100%",
    height: size.chip,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.pill,
    paddingInlineEnd: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: "transparent",
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  opens: {
    cursor: "pointer",
    backgroundColor: { default: color.surfaceSunken, ":hover": color.surfaceHover },
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.width,
  },
  compact: { paddingInlineEnd: space.pill },
  icon: { display: "inline-flex", color: color.textMuted },
  ref: {
    flexShrink: 0,
    maxWidth: `calc(100% - ${size.iconSm} - ${space.s2})`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    color: color.textLink,
  },
  quote: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: color.textMuted,
  },
  on: {
    backgroundColor: color.accentSubtle,
    borderColor: `color-mix(in srgb, ${color.accent} 55%, transparent)`,
  },
  notFound: { backgroundColor: color.dangerSubtle, borderColor: color.dangerBorder },
  notFoundText: { color: color.danger },
  notAtAnchor: { backgroundColor: color.warningSubtle, borderColor: color.warningBorder },
  notAtAnchorText: { color: color.warning },
  observedIcon: { color: color.info },
  observedWord: { flexShrink: 0, color: color.info },
  forceHover: { backgroundColor: color.surfaceHover },
  forceFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
});

export type SourceState = "ok" | "not-found" | "not-at-anchor";

const STATE: Record<Exclude<SourceState, "ok">, { icon: IconName; word: string; says: string }> = {
  "not-found": { icon: "x-circle", word: "Not found", says: "The quote is not in the document." },
  "not-at-anchor": {
    icon: "alert-triangle",
    word: "Not at its anchor",
    says: "The quote is in the document, but not at this anchor.",
  },
};

// ponytail: a quote is doc.md's exact text, Word bold and italic kept as **…** and *…*; the chip shows the words
// without the marks, as the passage does
const unmarked = (quote: string) =>
  quote.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1").replace(/\*(?=\S)([^*]*?\S)\*/g, "$1");

export type SourceChipProps = {
  /** where the claim comes from, formatted by the caller (« §5.6.6 », « fig:40 », « D401 §5.6.6 ») */
  reference: string;
  /** the passage's words (in the interface face: the serif is for whole passages); left out of a compact chip */
  quote?: string;
  /** opens the passage; without it the chip is only read */
  onOpen?: () => void;
  /** the mechanical check of the quote: found at its anchor, not found, or found elsewhere */
  state?: SourceState;
  /** the passage open now (aria-pressed) */
  pressed?: boolean;
  /** a figure: the image icon instead of the quote mark */
  figure?: boolean;
  /** from images or a video of the real system (not marked as the reference): says how to do a step, never what is
   * expected — the eye and the word « Observed » */
  observed?: boolean;
  /** inside a line of text: the reference alone */
  compact?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: not a Chip option — a source is two runs (the mono reference in the link colour, the muted quote)
// with the check's verdict, and it opens a passage; a Chip is one string you press or remove (catalogue note)
export function SourceChip({
  reference,
  quote,
  onOpen,
  state = "ok",
  pressed,
  figure = false,
  observed = false,
  compact = false,
  debugState,
}: SourceChipProps) {
  const bad = state === "ok" ? null : STATE[state];
  const words = quote ? unmarked(quote) : quote;
  const shownQuote = compact ? undefined : words;
  const look = stylex.props(
    styles.chip,
    onOpen && styles.opens,
    compact && styles.compact,
    pressed && styles.on,
    state === "not-found" && styles.notFound,
    state === "not-at-anchor" && styles.notAtAnchor,
    debugState === "hover" && styles.forceHover,
    debugState === "focus" && styles.forceFocus,
  );
  const tone = state === "not-found" ? styles.notFoundText : state === "not-at-anchor" ? styles.notAtAnchorText : null;
  const inner = (
    <>
      <span {...stylex.props(styles.icon, observed && !bad && styles.observedIcon, tone)}>
        <Icon
          name={bad ? bad.icon : observed ? "eye" : figure ? "image" : "quote"}
          size="sm"
          label={bad?.word ?? (observed ? "Observed" : undefined)}
        />
      </span>{" "}
      {observed && !compact && (
        <>
          <span {...stylex.props(styles.observedWord)}>Observed</span>{" "}
        </>
      )}
      <span {...stylex.props(styles.ref, tone)}>{reference}</span>
      {shownQuote && (
        <>
          {" "}
          <span {...stylex.props(styles.quote)}>“{shownQuote}”</span>
        </>
      )}
    </>
  );
  const tip = [
    words ? `${reference} — “${words}”` : reference,
    bad?.says,
    observed ? "Observed on the real system: it says how to do the step, not what is expected." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const chip = onOpen ? (
    <button type="button" aria-pressed={pressed} onClick={onOpen} {...look}>
      {inner}
    </button>
  ) : (
    <span {...look}>{inner}</span>
  );
  return <Tooltip label={tip}>{chip}</Tooltip>;
}
