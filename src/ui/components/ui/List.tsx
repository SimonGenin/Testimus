import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { border, color, fontSize, fontWeight, lineHeight, size, space, z } from "../../styles/tokens.stylex.ts";
import { ListItem, type ListItemProps } from "./ListItem.tsx";
import { useRowWindow } from "./rowWindow.ts";
import { Skeleton } from "./Skeleton.tsx";

const LOADING_ROWS = 3;

const styles = stylex.create({
  list: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: 0,
  },
  flush: { paddingBlock: 0 },
  group: { display: "flex", flexDirection: "column", margin: 0, padding: 0 },
  head: {
    position: "sticky",
    top: 0,
    zIndex: z.sticky,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    height: size.controlMd,
    paddingTop: space.s3,
    paddingBottom: 0,
    paddingInline: space.s5,
    backgroundColor: color.surface,
    color: color.textSubtle,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.medium,
    listStyle: "none",
  },
  headMeta: {
    marginInlineStart: "auto",
    color: color.textSubtle,
    fontWeight: fontWeight.regular,
    fontVariantNumeric: "tabular-nums",
  },
  more: {
    paddingBlock: space.s3,
    paddingInline: space.s5,
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    textAlign: "center",
    listStyle: "none",
  },
  sentinel: { height: border.width, listStyle: "none" },
});

export type ListProps<T> = {
  /** what the list holds (« Tests », « Jira folders »): its accessible name */
  label: string;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ListItemProps;
  /** single (default): a listbox — arrows move, Enter or a click picks one · none: a plain list of rows */
  selection?: "single" | "none";
  /** the picked row (the list keeps one) */
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** a tree (folders): rows are treeitems with their level; → opens a node, ← closes it or goes to its parent */
  tree?: boolean;
  /** a twisty was clicked, or → / ← on a node */
  onToggle?: (key: string) => void;
  /** one-line 32 px (default) · two-line 48 px; a row with a meta line is two lines anyway */
  density?: "one-line" | "two-line";
  /** full-width rows with a hairline (jobs, settings) */
  divided?: boolean;
  /** sticky heads with a count; rows show in the groups' order; action: a control in the head (« All 9 tests »);
   head false: no head, the label only names the group */
  groups?: { label: string; meta?: string; keys: string[]; action?: ReactNode; head?: boolean }[];
  /** skeleton rows in place of the rows (true: 3) — never the old rows */
  loading?: boolean | number;
  /** shown inside the list's frame when there is no row (an EmptyState) */
  empty?: ReactNode;
  /** paged lists: called near the end; with total, « x of y » on top until « All N loaded » */
  onEndReached?: () => void;
  total?: number;
  /** the focus stays in a field that drives the list (a combobox, the palette): no row takes the focus, `selected` is
   the active row, the field names it with aria-activedescendant={optionId(id, key)} and aria-controls={id}, the pointer
   over a row makes it the active one, and the active row is scrolled into view */
  activeDescendant?: { id: string; onActive: (key: string) => void };
};

export const optionId = (listId: string, key: string) => `${listId}-${encodeURIComponent(key)}`;

type Row<T> = { key: string; item: T; props: ListItemProps; group?: number; index: number };

// ponytail: every vertical list of things you pick from — tests, folders, documents, the review queue, jobs, contexts;
// one tab stop, the arrows move between rows (WAI listbox and tree, roving focus), Enter or a click picks one
export function List<T>({
  label,
  items,
  getKey,
  renderItem,
  selection = "single",
  selected = null,
  onSelect,
  tree = false,
  onToggle,
  density = "one-line",
  divided = false,
  groups,
  loading = false,
  empty,
  onEndReached,
  total,
  activeDescendant: ad,
}: ListProps<T>) {
  const refs = useRef(new Map<string, HTMLLIElement>());
  const end = useRef<HTMLLIElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const byKey = new Map(items.map((it) => [getKey(it), it]));
  const rows: Row<T>[] = (
    groups
      ? groups.flatMap((g, gi) =>
          g.keys.flatMap((k) => {
            const it = byKey.get(k);
            return it === undefined ? [] : [{ key: k, item: it, group: gi }];
          }),
        )
      : items.map((it) => ({ key: getKey(it), item: it }))
  ).map((r, index) => ({ ...r, index, props: renderItem(r.item) }));
  const open = rows.filter((r) => !r.props.disabled);
  const tabStop = [focusKey, selected, open[0]?.key].find((k) => k != null && open.some((r) => r.key === k)) ?? null;
  const frameRef = useRef<HTMLUListElement>(null);
  const win = useRowWindow(
    frameRef,
    refs,
    rows.map((r) => r.key),
    [selected, focusKey, tabStop],
  );
  // ponytail: a row the arrows went to that was not drawn yet takes the focus once it is
  const toFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const k = toFocus.current;
    const el = k ? refs.current.get(k) : undefined;
    if (!el) return;
    toFocus.current = null;
    el.focus();
  });

  useEffect(() => {
    const el = end.current;
    if (!el || !onEndReached || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) onEndReached();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onEndReached]);

  const pointed = !!ad;
  useEffect(() => {
    if (pointed && selected) refs.current.get(selected)?.scrollIntoView?.({ block: "nearest" });
  }, [pointed, selected]);

  const go = (key: string | undefined) => {
    if (key === undefined) return;
    setFocusKey(key);
    const el = refs.current.get(key);
    if (el) el.focus();
    else toFocus.current = key;
    if (key === open[open.length - 1]?.key) onEndReached?.();
  };
  const key = (e: KeyboardEvent<HTMLLIElement>, row: Row<T>) => {
    if (e.target !== e.currentTarget) return;
    const i = open.findIndex((r) => r.key === row.key);
    const depth = row.props.depth ?? 0;
    const moves: Record<string, string | undefined> = {
      ArrowDown: open[i + 1]?.key,
      ArrowUp: open[i - 1]?.key,
      Home: open[0]?.key,
      End: open[open.length - 1]?.key,
    };
    if (e.key in moves) {
      e.preventDefault();
      go(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(row.key);
    } else if (tree && e.key === "ArrowRight") {
      e.preventDefault();
      if (row.props.expanded === false) onToggle?.(row.key);
      else if (row.props.expanded === true) go(open[i + 1]?.key);
    } else if (tree && e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.props.expanded === true) onToggle?.(row.key);
      else go(open.slice(0, i).findLast((r) => (r.props.depth ?? 0) < depth)?.key);
    }
  };

  const busy = loading !== false;
  const frame = stylex.props(styles.list, divided && styles.flush);
  if (!busy && items.length === 0 && empty !== undefined)
    return (
      <section aria-label={label} {...frame}>
        {empty}
      </section>
    );
  const pick = selection === "single";
  const item = (r: Row<T>) => (
    <ListItem
      key={r.key}
      {...r.props}
      id={ad ? optionId(ad.id, r.key) : r.props.id}
      ref={(el: HTMLLIElement | null) => {
        if (el) refs.current.set(r.key, el);
        else refs.current.delete(r.key);
      }}
      role={pick ? (tree ? "treeitem" : "option") : undefined}
      selected={pick && r.key === selected}
      tabbable={pick && !ad && r.key === tabStop}
      focusable={!ad}
      twoLine={density === "two-line"}
      divided={divided}
      onActivate={() => {
        setFocusKey(r.key);
        onSelect?.(r.key);
      }}
      onToggle={() => onToggle?.(r.key)}
      onFocusRow={() => setFocusKey(r.key)}
      onHover={ad ? () => ad.onActive(r.key) : undefined}
      onKeyDown={(e) => key(e, r)}
    />
  );
  // ponytail: the rows of a long list not drawn are one room each run of them, as high as they were
  const draw = (list: Row<T>[]) => {
    if (win.all) return list.map(item);
    const out: ReactNode[] = [];
    let gap = 0;
    let from = "";
    const room = () => {
      if (gap > 0) out.push(<li key={`gap:${from}`} role="presentation" aria-hidden="true" style={{ height: gap }} />);
      gap = 0;
    };
    for (const r of list) {
      if (win.shown(r.index)) {
        room();
        out.push(item(r));
      } else {
        if (!gap) from = r.key;
        gap += win.room(r.key);
      }
    }
    room();
    return out;
  };
  const paged = total !== undefined;
  return (
    <ul
      ref={frameRef}
      id={ad?.id}
      role={pick ? (tree ? "tree" : "listbox") : undefined}
      aria-label={label}
      aria-busy={busy || undefined}
      {...frame}
    >
      {paged && !busy && items.length < total && (
        <li role="presentation" {...stylex.props(styles.more)}>
          {items.length} of {total}
        </li>
      )}
      {busy
        ? Array.from({ length: loading === true ? LOADING_ROWS : loading }, (_, n) => `loading-${n}`).map((k) => (
            <li key={k} role="presentation" {...stylex.props(styles.group)}>
              <Skeleton kind="row" />
            </li>
          ))
        : groups
          ? groups.map((g, gi) => {
              const inGroup = rows.filter((r) => r.group === gi);
              if (!inGroup.length) return null;
              return (
                <li key={g.label} role="presentation" {...stylex.props(styles.group)}>
                  <ul role={pick ? "group" : undefined} aria-label={g.label} {...stylex.props(styles.group)}>
                    {g.head !== false && (
                      <li role="presentation" {...stylex.props(styles.head)}>
                        <span aria-hidden="true">{g.label}</span>
                        {g.action}
                        {g.meta && (
                          <span aria-hidden="true" {...stylex.props(styles.headMeta)}>
                            {g.meta}
                          </span>
                        )}
                      </li>
                    )}
                    {draw(inGroup)}
                  </ul>
                </li>
              );
            })
          : draw(rows)}
      {paged && !busy && items.length >= total && onEndReached && (
        <li role="presentation" {...stylex.props(styles.more)}>
          All {total} loaded
        </li>
      )}
      {onEndReached && !busy && (
        <li ref={end} role="presentation" aria-hidden="true" {...stylex.props(styles.sentinel)} />
      )}
    </ul>
  );
}
