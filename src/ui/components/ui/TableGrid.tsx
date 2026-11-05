import * as stylex from "@stylexjs/stylex";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { border, color, radius, shadow, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Menu, type MenuEntry } from "./Menu.tsx";
import { Tooltip } from "./Tooltip.tsx";
import { type } from "./type.ts";

const HALF = `calc(${size.controlXs} / 2)`;
const INNER = `calc(${radius.r2} - ${border.width})`;

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  bar: { display: "flex", alignItems: "center", gap: space.s2, minHeight: size.controlXs, color: color.textSubtle },
  what: { color: color.textMuted },
  grow: { flex: 1 },
  scroller: {
    overflowX: "auto",
    paddingTop: HALF,
    paddingInlineStart: HALF,
    marginTop: `calc(-1 * ${HALF})`,
    marginInlineStart: `calc(-1 * ${HALF})`,
  },
  scrollerStill: { paddingTop: 0, paddingInlineStart: 0, marginTop: 0, marginInlineStart: 0 },
  table: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "separate",
    borderSpacing: 0,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderStrong,
    borderRadius: radius.r2,
    backgroundColor: color.surface,
  },
  wide: (cols: number) => ({ minWidth: `calc(${size.thumbLarge} * ${cols})` }),
  wideEdit: (cols: number) => ({ minWidth: `calc(${size.thumbLarge} * ${cols} + ${size.controlSm})` }),
  cell: {
    position: "relative",
    verticalAlign: "top",
    textAlign: "start",
    padding: 0,
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: color.border,
  },
  below: { borderBottomWidth: border.width },
  after: { borderInlineStartWidth: border.width },
  head: { backgroundColor: color.surfaceSunken },
  topStart: { borderStartStartRadius: INNER },
  topEnd: { borderStartEndRadius: INNER },
  bottomStart: { borderEndStartRadius: INNER },
  bottomEnd: { borderEndEndRadius: INNER },
  focus: { boxShadow: `inset 0 0 0 ${border.widthStrong} ${color.focusRing}` },
  handle: {
    position: "absolute",
    zIndex: 2,
    display: "inline-flex",
    borderRadius: radius.r1,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s1,
  },
  handleRow: { insetInlineStart: `calc(-1 * ${HALF})`, top: `calc(50% - ${HALF})` },
  handleCol: { top: `calc(-1 * ${HALF})`, insetInlineStart: `calc(50% - ${HALF})` },
  addCol: { position: "relative", width: size.controlSm, padding: 0, borderInlineStartWidth: border.width },
  ghost: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    width: "100%",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textSubtle, ":hover": color.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: `calc(-1 * ${border.widthStrong})`,
  },
  ghostCol: { position: "absolute", inset: 0, height: "100%" },
  ghostRow: { justifyContent: "flex-start", height: size.controlSm, paddingInline: space.s3 },
});

export type TableGridProps = {
  /** the table's accessible name (« Table in Expected Result of step 3 ») */
  label: string;
  rows: number;
  cols: number;
  /** the first row is the header row */
  head: boolean;
  /** what a cell holds — its text field (a Text with appearance cell), its pictures; focused: the cell being written */
  cell: (r: number, c: number, focused: boolean) => ReactNode;
  /** a row and a column as the menus name them (« Row « PK voie 1 » », « Header row », « Column 2 ») */
  rowName: (r: number) => string;
  colName: (c: number) => string;
  /** drawn without its bar, its handles and its ways to grow: a test Claude is writing, the review, an earlier version */
  readOnly?: boolean;
  /** the block's drag handle, at the start of the bar */
  grip?: ReactNode;
  /** the first cell takes the focus when it appears (a table just added) */
  autoFocus?: boolean;
  onInsertRow?: (at: number) => void;
  onDeleteRow?: (r: number) => void;
  onMoveRow?: (r: number, to: number) => void;
  onInsertCol?: (at: number) => void;
  onDeleteCol?: (c: number) => void;
  onMoveCol?: (c: number, to: number) => void;
  onHead?: (on: boolean) => void;
  onDelete?: () => void;
};

type At = { r: number; c: number };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const field = (td: Element | null | undefined) =>
  td?.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input");
const enter = (el: HTMLTextAreaElement | HTMLInputElement) => {
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
};

// ponytail: a grid you write in (SYSTEM.md Table, grid) — nothing shows only under the pointer: the bar above and the
// row and column that add one are always there, and the row and column of the cell being written carry a handle on
// their edge whose menu says what it does; a right click or Shift F10 opens the same actions on the cell. The grid
// knows no markup: every change is a callback, and the focus follows the cell it lands on
export function TableGrid({
  label,
  rows,
  cols,
  head,
  cell,
  rowName,
  colName,
  readOnly,
  grip,
  autoFocus,
  onInsertRow = () => {},
  onDeleteRow = () => {},
  onMoveRow = () => {},
  onInsertCol = () => {},
  onDeleteCol = () => {},
  onMoveCol = () => {},
  onHead = () => {},
  onDelete = () => {},
}: TableGridProps) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<At | null>(null);
  const [menu, setMenu] = useState<"row" | "col" | "cell" | null>(null);
  const want = useRef<At | null>(null);
  const firstBody = head ? 1 : 0;

  useEffect(() => {
    if (autoFocus && !readOnly) want.current = { r: 0, c: 0 };
  }, [autoFocus, readOnly]);

  // ponytail: after a change the focus goes to the cell it names — at once when that cell is drawn (the cells are drawn
  // by position, so the moved or inserted text arrives under it), else at the render that draws it (a row added last)
  useLayoutEffect(() => {
    const w = want.current;
    if (!w) return;
    const el = field(root.current?.querySelector(`[data-r="${w.r}"][data-c="${w.c}"]`));
    if (!el) return;
    want.current = null;
    enter(el);
  });

  const go = (r: number, c: number) => {
    want.current = { r, c };
    const el = field(root.current?.querySelector(`[data-r="${r}"][data-c="${c}"]`));
    if (el) {
      want.current = null;
      enter(el);
    }
  };

  const c0 = at?.c ?? 0;
  const r0 = at?.r ?? 0;
  const insertRow = (i: number, c = c0) => {
    go(i, c);
    onInsertRow(i);
  };
  const deleteRow = (r: number) => {
    go(Math.max(0, Math.min(r, rows - 2)), c0);
    onDeleteRow(r);
  };
  const moveRow = (r: number, to: number) => {
    go(to, c0);
    onMoveRow(r, to);
  };
  const insertCol = (i: number) => {
    go(0, i);
    onInsertCol(i);
  };
  const deleteCol = (c: number) => {
    go(r0, Math.max(0, Math.min(c, cols - 2)));
    onDeleteCol(c);
  };
  const moveCol = (c: number, to: number) => {
    go(r0, to);
    onMoveCol(c, to);
  };

  const canUp = (r: number) => r > firstBody;
  const canDown = (r: number) => r >= firstBody && r < rows - 1;
  const rowItems = (r: number): MenuEntry[] => [
    {
      label: "Insert row above",
      icon: "arrow-up",
      disabled: head && r === 0 ? "The header row stays first" : undefined,
      onSelect: () => insertRow(r),
    },
    { label: "Insert row below", icon: "arrow-down", onSelect: () => insertRow(r + 1) },
    {
      label: "Move up",
      icon: "chevron-up",
      shortcut: "Alt Shift ↑",
      disabled: !canUp(r),
      onSelect: () => moveRow(r, r - 1),
    },
    {
      label: "Move down",
      icon: "chevron-down",
      shortcut: "Alt Shift ↓",
      disabled: !canDown(r),
      onSelect: () => moveRow(r, r + 1),
    },
  ];
  const colItems = (c: number): MenuEntry[] => [
    { label: "Insert column left", icon: "arrow-left", onSelect: () => insertCol(c) },
    { label: "Insert column right", icon: "arrow-right", onSelect: () => insertCol(c + 1) },
    {
      label: "Move left",
      icon: "chevron-left",
      shortcut: "Alt Shift ←",
      disabled: c === 0,
      onSelect: () => moveCol(c, c - 1),
    },
    {
      label: "Move right",
      icon: "chevron-right",
      shortcut: "Alt Shift →",
      disabled: c === cols - 1,
      onSelect: () => moveCol(c, c + 1),
    },
  ];
  const headItem = (): MenuEntry => ({
    label: "Header row",
    icon: "table",
    checked: head,
    onSelect: () => onHead(!head),
  });
  const deleteRowItem = (r: number): MenuEntry => ({
    label: "Delete row",
    icon: "trash",
    danger: true,
    disabled: rows === 1 ? "The table's only row — delete the table instead" : undefined,
    onSelect: () => deleteRow(r),
  });
  const deleteColItem = (c: number): MenuEntry => ({
    label: "Delete column",
    icon: "trash",
    danger: true,
    disabled: cols === 1 ? "The table's only column — delete the table instead" : undefined,
    onSelect: () => deleteCol(c),
  });
  const rowEntries = (r: number): MenuEntry[] => [
    ...rowItems(r),
    ...(r === 0 ? ["separator" as const, headItem()] : []),
    "separator",
    deleteRowItem(r),
  ];
  const colEntries = (c: number): MenuEntry[] => [...colItems(c), "separator", deleteColItem(c)];
  const cellEntries = (r: number, c: number): MenuEntry[] => [
    { group: rowName(r) },
    ...rowItems(r),
    { group: colName(c) },
    ...colItems(c),
    "separator",
    headItem(),
    "separator",
    deleteRowItem(r),
    deleteColItem(c),
  ];
  const tableEntries: MenuEntry[] = [
    { label: "Add row", icon: "plus", onSelect: () => insertRow(rows) },
    { label: "Add column", icon: "plus", onSelect: () => insertCol(cols) },
    headItem(),
    "separator",
    { label: "Delete table", icon: "trash", danger: true, onSelect: onDelete },
  ];

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement;
    if (!at || target.closest('[role="menu"], [data-handle]')) return;
    const { r, c } = at;
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.shiftKey) {
        if (r === 0 && c === 0) return;
        e.preventDefault();
        return c > 0 ? go(r, c - 1) : go(r - 1, cols - 1);
      }
      e.preventDefault();
      if (r === rows - 1 && c === cols - 1) return insertRow(rows, 0);
      return c < cols - 1 ? go(r, c + 1) : go(r + 1, 0);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      target.blur();
      setAt(null);
      return;
    }
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      setMenu("cell");
      return;
    }
    if (e.altKey && e.shiftKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowUp" && canUp(r)) moveRow(r, r - 1);
      if (e.key === "ArrowDown" && canDown(r)) moveRow(r, r + 1);
      if (e.key === "ArrowLeft" && c > 0) moveCol(c, c - 1);
      if (e.key === "ArrowRight" && c < cols - 1) moveCol(c, c + 1);
    }
  };

  const onFocus = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-handle]")) return;
    const td = target.closest<HTMLElement>("[data-r]");
    if (!td) return;
    const next = { r: Number(td.dataset.r), c: Number(td.dataset.c) };
    if (at?.r !== next.r || at?.c !== next.c) {
      setAt(next);
      setMenu(null);
    }
  };
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && root.current?.contains(to)) return;
    setAt(null);
    setMenu(null);
  };

  const handle = (kind: "row" | "col", i: number) => {
    const open = kind === "row" ? menu === "row" || menu === "cell" : menu === "col";
    const name = kind === "row" ? rowName(i) : colName(i);
    return (
      <span data-handle {...stylex.props(styles.handle, kind === "row" ? styles.handleRow : styles.handleCol)}>
        <Menu
          open={open}
          onOpenChange={(v) => setMenu(v ? kind : null)}
          align={kind === "row" ? "beside" : "start"}
          label={menu === "cell" && kind === "row" ? `${name}, ${lower(colName(c0))}` : name}
          entries={kind === "col" ? colEntries(i) : menu === "cell" ? cellEntries(i, c0) : rowEntries(i)}
          trigger={
            <Button
              variant="quiet"
              size="xs"
              iconOnly
              icon={kind === "row" ? "grip" : "more"}
              label={`Options for ${lower(name)}`}
            />
          }
        />
      </span>
    );
  };

  const edit = !readOnly;
  const last = rows - 1;
  return (
    <div ref={root} {...stylex.props(styles.block)} onFocus={onFocus} onBlur={onBlur}>
      {edit && (
        <div {...stylex.props(type.small, styles.bar)}>
          {grip}
          <span {...stylex.props(type.medium, styles.what)}>Table</span>
          <span {...stylex.props(type.tabular)}>
            {plural(rows, "row")} · {plural(cols, "column")}
          </span>
          <span {...stylex.props(styles.grow)} />
          <Menu
            align="end"
            entries={tableEntries}
            trigger={<Button variant="quiet" size="xs" iconOnly icon="more" label="Table options" />}
          />
        </div>
      )}
      <div {...stylex.props(styles.scroller, readOnly && styles.scrollerStill)}>
        <table
          aria-label={label}
          onKeyDown={onKey}
          {...stylex.props(styles.table, edit ? styles.wideEdit(cols) : styles.wide(cols))}
        >
          <colgroup>
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} />
            ))}
            {edit && <col {...stylex.props(styles.addCol)} />}
          </colgroup>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => {
                  const Cell = head && r === 0 ? "th" : "td";
                  const focused = edit && at?.r === r && at?.c === c;
                  const bottom = r === last && readOnly;
                  return (
                    <Cell
                      key={c}
                      scope={Cell === "th" ? "col" : undefined}
                      data-r={r}
                      data-c={c}
                      onContextMenu={
                        edit
                          ? (e) => {
                              e.preventDefault();
                              field(e.currentTarget)?.focus();
                              setAt({ r, c });
                              setMenu("cell");
                            }
                          : undefined
                      }
                      {...stylex.props(
                        styles.cell,
                        (r < last || edit) && styles.below,
                        c > 0 && styles.after,
                        Cell === "th" && [styles.head, type.medium],
                        r === 0 && c === 0 && styles.topStart,
                        r === 0 && c === cols - 1 && readOnly && styles.topEnd,
                        bottom && c === 0 && styles.bottomStart,
                        bottom && c === cols - 1 && styles.bottomEnd,
                        focused && styles.focus,
                      )}
                    >
                      {cell(r, c, focused)}
                      {edit && at?.r === r && c === 0 && handle("row", r)}
                      {edit && at?.c === c && r === 0 && handle("col", c)}
                    </Cell>
                  );
                })}
                {edit && r === 0 && (
                  <td rowSpan={rows} {...stylex.props(styles.cell, styles.addCol, styles.below, styles.topEnd)}>
                    <Tooltip label="Add column">
                      <button
                        type="button"
                        aria-label="Add column"
                        onClick={() => insertCol(cols)}
                        {...stylex.props(styles.ghost, styles.ghostCol, styles.topEnd)}
                      >
                        <Icon name="plus" size="sm" />
                      </button>
                    </Tooltip>
                  </td>
                )}
              </tr>
            ))}
            {edit && (
              <tr>
                <td colSpan={cols + 1} {...stylex.props(styles.cell, styles.bottomStart, styles.bottomEnd)}>
                  <button
                    type="button"
                    onClick={() => insertRow(rows)}
                    {...stylex.props(
                      type.small,
                      type.medium,
                      styles.ghost,
                      styles.ghostRow,
                      styles.bottomStart,
                      styles.bottomEnd,
                    )}
                  >
                    <Icon name="plus" size="sm" />
                    Add row
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
