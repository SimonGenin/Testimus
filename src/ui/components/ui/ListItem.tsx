import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, useState } from "react";
import { border, color, fontSize, fontWeight, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { keyboardFocus } from "./layer.ts";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  item: {
    position: "relative",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.row,
    marginBlock: 0,
    marginInline: space.s3,
    paddingBlock: space.snug,
    paddingInline: space.s3,
    borderRadius: radius.r2,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    listStyle: "none",
    outline: "none",
  },
  pickable: { cursor: "pointer" },
  two: { minHeight: size.row2, alignItems: "flex-start", paddingBlock: space.pill },
  divided: {
    marginInline: 0,
    borderRadius: 0,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    paddingInline: space.s5,
  },
  hover: { backgroundColor: color.surfaceHover },
  selected: { backgroundColor: color.surfaceSelected },
  focus: {
    outline: `${border.widthStrong} solid ${color.focusRing}`,
    outlineOffset: `calc(-1 * ${border.widthStrong})`,
  },
  disabled: { color: color.textDisabled, cursor: "not-allowed" },
  danger: { color: color.danger },
  indent: { flex: "none", display: "inline-block" },
  twisty: { flex: "none", display: "inline-flex", width: size.iconMd, color: color.textSubtle, cursor: "pointer" },
  twistyTwo: { alignSelf: "center" },
  lead: { flex: "none", display: "inline-flex", alignItems: "center", color: color.textMuted },
  leadTwo: { marginTop: border.width },
  leadDanger: { color: color.danger },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  titleLine: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  titleWrap: { overflow: "visible", whiteSpace: "normal", overflowWrap: "anywhere" },
  wrapped: { alignItems: "flex-start" },
  titleOn: { fontWeight: fontWeight.medium },
  tip: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0 },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.snug,
    rowGap: space.s1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  metaOff: { color: color.textDisabled },
  actions: { display: "inline-flex", alignItems: "center", gap: space.s1, flex: "none" },
  trail: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textSubtle,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
});

export type ListItemProps = {
  /** the name (a test's summary, a document's title); ends with an ellipsis when too long */
  title: ReactNode;
  /** inline badges after the title */
  badges?: ReactNode;
  /** the second line: a mono key, a folder, a time, a state badge (makes the row two lines) */
  meta?: ReactNode;
  /** before the body: an icon, a status icon, a checkbox */
  lead?: ReactNode;
  /** after the body: a count, a time, a chevron */
  trail?: ReactNode;
  /** icon buttons (xs) shown on hover and focus, in place of the trail so nothing moves */
  actions?: ReactNode;
  /** the row's id, for a field that points at its active option (a combobox's aria-activedescendant) */
  id?: string;
  /** tree level, from 0 (indented 16 px per level) */
  depth?: number;
  /** a tree node: true open, false closed (a twisty); null a leaf beside nodes (the twisty's room) */
  expanded?: boolean | null;
  disabled?: boolean;
  /** a destructive row */
  danger?: boolean;
  /** the full title, on hover and focus */
  tooltip?: string;
  /** the title wraps onto as many lines as it needs instead of ending with an ellipsis (a transcript line) */
  wrap?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

export type ListRowProps = ListItemProps & {
  role?: "option" | "treeitem";
  selected?: boolean;
  tabbable?: boolean;
  /** false: the row never takes the focus (a field keeps it and points at the row) */
  focusable?: boolean;
  twoLine?: boolean;
  divided?: boolean;
  onActivate?: () => void;
  onToggle?: () => void;
  onFocusRow?: () => void;
  /** the pointer came over the row */
  onHover?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLLIElement>) => void;
  ref?: Ref<HTMLLIElement>;
};

// ponytail: one row of a List — the List gives it its role, its selection and the keyboard; it draws the row and shows
// its actions while the pointer or the focus is on it
export function ListItem({
  id,
  title,
  badges,
  meta,
  lead,
  trail,
  actions,
  depth,
  expanded,
  disabled = false,
  danger = false,
  tooltip,
  wrap = false,
  debugState,
  role,
  selected = false,
  tabbable = false,
  focusable = true,
  twoLine = false,
  divided = false,
  onActivate,
  onToggle,
  onFocusRow,
  onHover,
  onKeyDown,
  ref,
}: ListRowProps) {
  const [hover, setHover] = useState(false);
  const [within, setWithin] = useState(false);
  const [focused, setFocused] = useState(false);
  const two = twoLine || meta !== undefined;
  const lit = hover || debugState === "hover";
  const ringed = focused || debugState === "focus";
  const showActions = actions !== undefined && (lit || within || debugState === "focus");
  const interactive = role !== undefined;
  const aria = {
    "aria-selected": interactive ? selected : undefined,
    "aria-disabled": disabled || undefined,
    "aria-level": role === "treeitem" ? (depth ?? 0) + 1 : undefined,
    "aria-expanded": role === "treeitem" && typeof expanded === "boolean" ? expanded : undefined,
  };
  const titleText = (
    <span {...stylex.props(styles.title, wrap && styles.titleWrap, selected && styles.titleOn)}>{title}</span>
  );
  return (
    <li
      id={id}
      ref={ref}
      role={role}
      {...aria}
      tabIndex={interactive && focusable ? (tabbable ? 0 : -1) : undefined}
      onPointerEnter={() => setHover(true)}
      onMouseEnter={onHover}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => {
        setWithin(true);
        if (e.target === e.currentTarget) {
          setFocused(keyboardFocus());
          onFocusRow?.();
        }
      }}
      onBlur={(e) => {
        if (e.target === e.currentTarget) setFocused(false);
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setWithin(false);
      }}
      onClick={(e: MouseEvent<HTMLLIElement>) => {
        if (disabled || !interactive) return;
        if ((e.target as Element).closest("[data-twisty]")) onToggle?.();
        else if (!(e.target as Element).closest("button, a, input")) onActivate?.();
      }}
      onKeyDown={onKeyDown}
      {...stylex.props(
        styles.item,
        interactive && !disabled && styles.pickable,
        two && styles.two,
        wrap && styles.wrapped,
        divided && styles.divided,
        lit && !disabled && styles.hover,
        selected && styles.selected,
        ringed && styles.focus,
        danger && styles.danger,
        disabled && styles.disabled,
      )}
    >
      {depth !== undefined && depth > 0 && (
        <span {...stylex.props(styles.indent)} style={{ width: `calc(${size.iconMd} * ${depth})` }} />
      )}
      {expanded !== undefined && (
        <span data-twisty="" aria-hidden="true" {...stylex.props(styles.twisty, two && styles.twistyTwo)}>
          {expanded !== null && <Icon name={expanded ? "chevron-down" : "chevron-right"} size="sm" />}
        </span>
      )}
      {lead && <span {...stylex.props(styles.lead, two && styles.leadTwo, danger && styles.leadDanger)}>{lead}</span>}
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.titleLine)}>
          {tooltip ? (
            <span {...stylex.props(styles.tip)}>
              <Tooltip label={tooltip}>{titleText}</Tooltip>
            </span>
          ) : (
            titleText
          )}
          {badges}
        </div>
        {meta !== undefined && <div {...stylex.props(styles.meta, disabled && styles.metaOff)}>{meta}</div>}
      </div>
      {showActions && <span {...stylex.props(styles.actions)}>{actions}</span>}
      {trail !== undefined && !showActions && <span {...stylex.props(styles.trail)}>{trail}</span>}
    </li>
  );
}
