import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId } from "react";
import { border, color, duration, easing, focus, radius, shadow, size, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
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
    paddingBlockStart: space.s5,
    paddingBlockEnd: space.s4,
    paddingInline: space.s6,
    boxSizing: "border-box",
  },
  headCompact: { minHeight: 0, paddingBlockStart: space.s4, paddingBlockEnd: space.s3, paddingInline: space.s5 },
  headTight: { minHeight: 0, paddingBlockStart: space.s3, paddingBlockEnd: space.s2, paddingInline: space.s3 },
  title: { minWidth: 0 },
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  note: { color: color.textSubtle },
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
  bodyCompact: { gap: space.s3, paddingBlockEnd: space.s4, paddingInline: space.s5 },
  bodyCompactAlone: { paddingBlockStart: space.s4 },
  bodyTight: { gap: space.s3, paddingBlockEnd: space.s3, paddingInline: space.s3 },
  bodyTightAlone: { paddingBlockStart: space.s3 },
  /** a radio card's body starts under its title, not under the radio */
  bodyUnderRadio: { paddingInlineStart: `calc(${space.s5} + ${size.iconMd} + ${space.s3})` },
  fill: { flex: 1, height: "100%" },
  sunken: { backgroundColor: color.surfaceSunken, boxShadow: "none" },
  bodyFill: { flex: 1 },
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
  footCompact: { paddingBlock: space.s3, paddingInline: space.s5 },
  footTight: { paddingBlock: space.s2, paddingInline: space.s3 },
  foldHead: {
    width: "100%",
    margin: 0,
    borderWidth: 0,
    borderRadius: radius.r3,
    backgroundColor: "transparent",
    color: { default: "inherit", ":hover": color.textLink },
    fontFamily: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  foldHeadOpen: { paddingBlockEnd: space.s3 },
  foldHover: { color: color.textLink },
  foldFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  chevron: {
    display: "inline-flex",
    flex: "none",
    color: color.textSubtle,
    transitionProperty: "transform",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
  },
  chevronOpen: { transform: "rotate(90deg)" },
  foldTitle: { flex: 1, minWidth: 0 },
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
  /** under the title, small and subtle: what the card is for (a settings group); not part of the card's name */
  note?: ReactNode;
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
  /** a card that opens: its name, when its whole text is too much to read out (a figure's tile: its caption) */
  label?: string;
  children: ReactNode;
  /** false: the body has no padding (a list or a table fills it) */
  padded?: boolean;
  /** default: 24 px (settings sections, the step card) · compact: 12/16 px (a finding, a radio card among several, a
   * figure's detail) · tight: 8 px (a figure's tile in a grid) */
  density?: "default" | "compact" | "tight";
  /** the card fills its grid cell, so the cards of a row are as tall as each other and their foots line up */
  fill?: boolean;
  /** on the sunken ground, no shadow: a card that sits inside another frame (a step's finding inside the step) */
  sunken?: boolean;
  /** the card is a choice among cards (packs, drives): a radio in the head, the whole card picks it, arrows move between
   * the cards of the same name; put the cards in an element with role radiogroup */
  radio?: { name: string; value: string; checked: boolean; onSelect: (value: string) => void; disabled?: boolean };
  /** the card folds behind its head (a test Claude is writing, among others): the head is one button with a chevron
   * that opens or folds the body; actions then hold no control (badges only) and the foot shows only when open */
  fold?: { open: boolean; onOpenChange: (open: boolean) => void };
  /** the catalogue only (a radio card, a card that opens or folds) */
  debugState?: "hover" | "focus";
};

// ponytail: a framed group with a head, a body and a foot — settings sections, packs, findings, the step card; a state is
// a badge in the head, never a coloured edge; cards nest once at most
export function Card({
  title,
  note,
  actions,
  footer,
  selected = false,
  focused = false,
  edge,
  dashed = false,
  onOpen,
  label,
  children,
  padded = true,
  density = "default",
  fill = false,
  sunken = false,
  radio,
  fold,
  debugState,
}: CardProps) {
  const id = useId();
  const bodyId = useId();
  const frame = [
    styles.card,
    dashed && styles.dashed,
    edge && EDGE[edge],
    dashed && edge && styles.dashedEdge,
    selected && styles.selected,
    focused && styles.focused,
    fill && styles.fill,
    sunken && styles.sunken,
  ];
  const alone = !title && !radio && !actions;
  const compact = density === "compact";
  const tight = density === "tight";
  const headLook = [styles.head, compact && styles.headCompact, tight && styles.headTight];
  const bodyLook = [
    styles.body,
    alone && styles.bodyAlone,
    compact && styles.bodyCompact,
    compact && alone && styles.bodyCompactAlone,
    tight && styles.bodyTight,
    tight && alone && styles.bodyTightAlone,
    radio && compact && styles.bodyUnderRadio,
    fill && styles.bodyFill,
    !padded && styles.flush,
  ];
  const body = <div {...stylex.props(bodyLook)}>{children}</div>;
  const foot = footer && (
    <div {...stylex.props(styles.foot, compact && styles.footCompact, tight && styles.footTight)}>{footer}</div>
  );
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
        <div {...stylex.props(headLook)}>
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
        aria-label={label}
        aria-pressed={selected || undefined}
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
          <span {...stylex.props(headLook)}>
            {title && <span {...stylex.props(type.titleSm, styles.title)}>{title}</span>}
            {actions && <span {...stylex.props(styles.actions)}>{actions}</span>}
          </span>
        )}
        <span {...stylex.props(bodyLook)}>{children}</span>
        {footer && (
          <span {...stylex.props(styles.foot, compact && styles.footCompact, tight && styles.footTight)}>{footer}</span>
        )}
      </button>
    );
  if (fold)
    return (
      <section aria-labelledby={id} {...stylex.props(frame)}>
        <button
          type="button"
          aria-expanded={fold.open}
          aria-controls={fold.open ? bodyId : undefined}
          onClick={() => fold.onOpenChange(!fold.open)}
          {...stylex.props(
            headLook,
            styles.foldHead,
            fold.open && styles.foldHeadOpen,
            debugState === "hover" && styles.foldHover,
            debugState === "focus" && styles.foldFocus,
          )}
        >
          <span {...stylex.props(styles.chevron, fold.open && styles.chevronOpen)}>
            <Icon name="chevron-right" size="sm" />
          </span>
          <span id={id} {...stylex.props(type.titleSm, styles.title, styles.foldTitle)}>
            {title}
          </span>
          {actions && <span {...stylex.props(styles.actions)}>{actions}</span>}
        </button>
        {fold.open && (
          <div id={bodyId} {...stylex.props(bodyLook)}>
            {children}
          </div>
        )}
        {fold.open && foot}
      </section>
    );
  const named = title && (
    <span id={id} {...stylex.props(type.titleSm, styles.title)}>
      {title}
    </span>
  );
  const head = (title || actions) && (
    <div {...stylex.props(headLook)}>
      {note ? (
        <span {...stylex.props(styles.titles)}>
          {named}
          <span {...stylex.props(type.small, styles.note)}>{note}</span>
        </span>
      ) : (
        named
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
