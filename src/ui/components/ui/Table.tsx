import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, fontSize, fontWeight, lineHeight, radius, size, space, z } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { Skeleton } from "./Skeleton.tsx";

const LOADING_ROWS = 3;

const styles = stylex.create({
  wrap: {
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "auto",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
  },
  fill: { height: "100%" },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: z.sticky,
    boxSizing: "border-box",
    height: size.tableHead,
    paddingBlock: 0,
    paddingInline: space.s4,
    backgroundColor: color.surface,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    color: color.textSubtle,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.semibold,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  td: {
    boxSizing: "border-box",
    paddingBlock: space.s4,
    paddingInline: space.s4,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    verticalAlign: "top",
  },
  lastRow: { borderBottomWidth: 0 },
  middle: { verticalAlign: "middle" },
  denseTh: { paddingInline: space.s3 },
  denseTd: { paddingBlock: space.s2, paddingInline: space.s3 },
  gridCell: { borderInlineEndStyle: "solid", borderInlineEndWidth: border.width, borderInlineEndColor: color.border },
  lastCell: { borderInlineEndWidth: 0 },
  num: { textAlign: "end", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  row: { backgroundColor: { default: null, ":hover": color.surfaceHover } },
  clickable: { cursor: "pointer" },
  rowSelected: { backgroundColor: { default: color.surfaceSelected, ":hover": color.surfaceSelected } },
  rowHover: { backgroundColor: color.surfaceHover },
  rowLit: { backgroundColor: { default: color.highlight, ":hover": color.highlight }, color: color.highlightText },
  sort: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.r1,
    backgroundColor: "transparent",
    color: { default: "inherit", ":hover": color.text },
    font: "inherit",
    letterSpacing: "inherit",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.width,
  },
  sorted: { color: color.text },
  open: {
    display: "block",
    width: "100%",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "inherit",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.width,
  },
  empty: { paddingBlock: space.s5, color: color.textMuted, textAlign: "center" },
});

export type TableColumn<R> = {
  key: string;
  label: string;
  /** right-aligned, tabular figures */
  numeric?: boolean;
  /** the head sorts by it (see sort and onSort) */
  sortable?: boolean;
  /** a percentage or a size token */
  width?: string;
  /** the cell; default the row's field of the same key */
  render?: (row: R) => ReactNode;
};

export type TableProps<R> = {
  /** what the table shows (« Vector spaces »): its accessible name */
  label: string;
  columns: TableColumn<R>[];
  rows: R[];
  getKey: (row: R) => string;
  /** tighter cells, for long tables in a card */
  dense?: boolean;
  /** cell borders (the step's table block) */
  grid?: boolean;
  /** cells centred on the row's height (a check's state, its result and its fix side by side), not on their top */
  middle?: boolean;
  /** the open row */
  selected?: string | null;
  /** the row a quote lands in: lit, and marked data-focus for the reader that scrolls to it */
  lit?: string | null;
  /** the rows open something: the first cell is a button (keyboard), the whole row takes the click */
  onRowSelect?: (key: string) => void;
  /** the column sorted and its direction */
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  /** one row with this message when there is none */
  empty?: ReactNode;
  /** skeleton rows, never the old rows */
  loading?: boolean;
  /** fills its container's height and scrolls inside it, the head staying on top */
  fill?: boolean;
  /** the catalogue only: a row shown hovered */
  debugHover?: string;
};

const cellOf = <R,>(row: R, c: TableColumn<R>): ReactNode =>
  c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "");

// ponytail: data in rows and columns — a list of things you open is a List, not a table; the head stays on top while
// the body scrolls
export function Table<R>({
  label,
  columns,
  rows,
  getKey,
  dense = false,
  grid = false,
  middle = false,
  selected,
  lit,
  onRowSelect,
  sort,
  onSort,
  empty,
  loading = false,
  fill = false,
  debugHover,
}: TableProps<R>) {
  const last = columns.length - 1;
  const cell = (i: number, td: boolean, lastRow = false) =>
    stylex.props(
      td ? styles.td : styles.th,
      dense && (td ? styles.denseTd : styles.denseTh),
      grid && styles.gridCell,
      middle && td && styles.middle,
      i === last && styles.lastCell,
      columns[i].numeric && styles.num,
      lastRow && styles.lastRow,
    );
  const body: ReactNode[] = loading
    ? Array.from({ length: LOADING_ROWS }, (_, n) => `loading-${n}`).map((k, n) => (
        <tr key={k}>
          {columns.map((c, i) => (
            <td key={c.key} {...cell(i, true, n === LOADING_ROWS - 1)}>
              <Skeleton width={c.numeric ? "40%" : "70%"} />
            </td>
          ))}
        </tr>
      ))
    : rows.map((r, n) => {
        const key = getKey(r);
        const on = key === selected;
        const isLast = n === rows.length - 1;
        return (
          <tr
            key={key}
            aria-current={on ? "true" : undefined}
            data-focus={key === lit ? "" : undefined}
            onClick={onRowSelect ? () => onRowSelect(key) : undefined}
            {...stylex.props(
              styles.row,
              onRowSelect && styles.clickable,
              debugHover === key && styles.rowHover,
              on && styles.rowSelected,
              key === lit && styles.rowLit,
            )}
          >
            {columns.map((c, i) => (
              <td key={c.key} {...cell(i, true, isLast)}>
                {i === 0 && onRowSelect ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRowSelect(key);
                    }}
                    {...stylex.props(styles.open)}
                  >
                    {cellOf(r, c)}
                  </button>
                ) : (
                  cellOf(r, c)
                )}
              </td>
            ))}
          </tr>
        );
      });
  return (
    <div {...stylex.props(styles.wrap, fill && styles.fill)}>
      <table aria-label={label} aria-busy={loading || undefined} {...stylex.props(styles.table)}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const by = sort?.key === c.key ? sort.dir : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={by === "asc" ? "ascending" : by === "desc" ? "descending" : undefined}
                  {...cell(i, false)}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      {...stylex.props(styles.sort, by && styles.sorted)}
                    >
                      {c.label}
                      <Icon name={by === "asc" ? "arrow-up" : by === "desc" ? "arrow-down" : "sort"} size="sm" />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} {...stylex.props(styles.td, styles.lastRow, styles.empty)}>
                {empty ?? "Nothing to show."}
              </td>
            </tr>
          ) : (
            body
          )}
        </tbody>
      </table>
    </div>
  );
}
