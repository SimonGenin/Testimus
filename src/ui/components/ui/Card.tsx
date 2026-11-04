import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId } from "react";
import { border, color, duration, easing, focus, radius, shadow, size, space } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    margin: 0,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
    color: color.text,
    transitionProperty: "border-color, box-shadow, background-color",
    transitionDuration: duration.instant,
    transitionTimingFunction: easing.standard,
  },
  selected: { borderColor: color.accent, boxShadow: `0 0 0 ${border.width} ${color.accent}` },
  focused: { outline: `${border.widthStrong} solid ${color.focusRing}`, outlineOffset: space.s1 },
  warning: { borderColor: color.warningBorder },
  success: { borderColor: color.successBorder },
  claudeEdge: { borderColor: color.claudeBorder },
  danger: { borderColor: color.dangerBorder, boxShadow: `0 0 0 ${border.width} ${color.dangerBorder}` },
  dashed: {
    borderStyle: "dashed",
    borderColor: color.borderField,
    backgroundColor: "transparent",
    boxShadow: "none",
    color: color.textMuted,
  },
  open: {
    width: "100%",
    padding: 0,
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    fontWeight: "inherit",
    letterSpacing: "inherit",
    textAlign: "start",
    cursor: "pointer",
    backgroundColor: { default: color.surface, ":hover": color.surfaceHover, ":active": color.surfacePressed },
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  dashedEdge: { boxShadow: "none" },
  openDashed: { backgroundColor: { default: "transparent", ":hover": color.surfaceHover } },
  openHover: { backgroundColor: color.surfaceHover },
  openFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  pick: {
    position: "relative",
    cursor: "pointer",
    backgroundColor: { default: color.surface, ":hover": color.surfaceHover },
  },
  pickHover: { backgroundColor: color.surfaceHover },
  pickFocus: { outline: `${border.widthStrong} solid ${color.focusRing}`, outlineOffset: border.widthStrong },
  pickDisabled: { cursor: "not-allowed", backgroundColor: color.surfaceSunken, color: color.textDisabled },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.cardHead,
    paddingBlock: space.s5,
    paddingInline: space.s6,
    boxSizing: "border-box",
  },
  title: { minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, marginInlineStart: "auto" },
  body: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingBlockStart: 0,
    paddingBlockEnd: space.s6,
    paddingInline: space.s6,
    minWidth: 0,
  },
  bodyAlone: { paddingBlockStart: space.s6 },
  flush: { paddingBlockStart: 0, paddingBlockEnd: 0, paddingInline: 0, gap: 0 },
  foot: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s6,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  radio: {
    flex: "none",
    width: size.iconMd,
    height: size.iconMd,
    margin: 0,
    accentColor: color.accent,
    cursor: "inherit",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.width,
  },
});

const EDGE = {
  warning: styles.warning,
  success: styles.success,
  claude: styles.claudeEdge,
  danger: styles.danger,
} as const;

export type CardProps = {
  /** in the head (a string, or a title with its badges) */
  title?: ReactNode;
  /** on the right of the head: buttons, a menu */
  actions?: ReactNode;
  /** a foot under a hairline: secondary actions, a note */
  footer?: ReactNode;
  /** the one in use or in focus (the pack in use, the picked figure): an accent edge */
  selected?: boolean;
  /** where the keyboard is (the focused step): the focus ring around the card */
  focused?: boolean;
  /** the step card's diff state, drawn as the whole edge (never a left bar), always with its badge in the head:
   * warning (modified) · success (new) · claude (changed by Claude) · danger (unreadable: a doubled edge) */
  edge?: "warning" | "success" | "claude" | "danger";
  /** a place for something not there yet (a step being written, « Add a step », files to attach): a dashed edge on no
   * ground, muted text */
  dashed?: boolean;
  /** the whole card opens something (a figure's tile, a test's summary): it is one button, with hover and focus; it
   * then holds no other control */
  onOpen?: () => void;
  children: ReactNode;
  /** false: the body has no padding (a list or a table fills it) */
  padded?: boolean;
  /** the card is a choice among cards (packs, drives): a radio in the head, the whole card picks it, arrows move between
   * the cards of the same name; put the cards in an element with role radiogroup */
  radio?: { name: string; value: string; checked: boolean; onSelect: (value: string) => void; disabled?: boolean };
  /** the catalogue only (a radio card, a card that opens) */
  debugState?: "hover" | "focus";
};

// ponytail: a framed group with a head, a body and a foot — settings sections, packs, findings, the step card; a state is
// a badge in the head, never a coloured edge; cards nest once at most
export function Card({
  title,
  actions,
  footer,
  selected = false,
  focused = false,
  edge,
  dashed = false,
  onOpen,
  children,
  padded = true,
  radio,
  debugState,
}: CardProps) {
  const id = useId();
  const frame = [
    styles.card,
    dashed && styles.dashed,
    edge && EDGE[edge],
    dashed && edge && styles.dashedEdge,
    selected && styles.selected,
    focused && styles.focused,
  ];
  const body = (
    <div {...stylex.props(styles.body, !title && !radio && !actions && styles.bodyAlone, !padded && styles.flush)}>
      {children}
    </div>
  );
  const foot = footer && <div {...stylex.props(styles.foot)}>{footer}</div>;
  if (radio) {
    const off = radio.disabled === true;
    return (
      <label
        {...stylex.props(
          frame,
          styles.pick,
          radio.checked && styles.selected,
          debugState === "hover" && styles.pickHover,
          debugState === "focus" && styles.pickFocus,
          off && styles.pickDisabled,
        )}
      >
        <div {...stylex.props(styles.head)}>
          <input
            type="radio"
            name={radio.name}
            value={radio.value}
            checked={radio.checked}
            disabled={off}
            aria-labelledby={title ? id : undefined}
            onChange={() => radio.onSelect(radio.value)}
            {...stylex.props(styles.radio)}
          />
          {title && (
            <span id={id} {...stylex.props(type.titleSm, styles.title)}>
              {title}
            </span>
          )}
          {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
        </div>
        {body}
        {foot}
      </label>
    );
  }
  if (onOpen)
    return (
      <button
        type="button"
        onClick={onOpen}
        {...stylex.props(
          frame,
          styles.open,
          dashed && styles.openDashed,
          debugState === "hover" && styles.openHover,
          debugState === "focus" && styles.openFocus,
        )}
      >
        {(title || actions) && (
          <span {...stylex.props(styles.head)}>
            {title && <span {...stylex.props(type.titleSm, styles.title)}>{title}</span>}
            {actions && <span {...stylex.props(styles.actions)}>{actions}</span>}
          </span>
        )}
        <span {...stylex.props(styles.body, !title && !actions && styles.bodyAlone, !padded && styles.flush)}>
          {children}
        </span>
        {footer && <span {...stylex.props(styles.foot)}>{footer}</span>}
      </button>
    );
  const head = (title || actions) && (
    <div {...stylex.props(styles.head)}>
      {title && (
        <span id={id} {...stylex.props(type.titleSm, styles.title)}>
          {title}
        </span>
      )}
      {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
    </div>
  );
  return title ? (
    <section aria-labelledby={id} {...stylex.props(frame)}>
      {head}
      {body}
      {foot}
    </section>
  ) : (
    <div {...stylex.props(frame)}>
      {head}
      {body}
      {foot}
    </div>
  );
}
