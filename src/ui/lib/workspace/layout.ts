// ponytail: the arrangement of a screen's tabs — columns side by side, each holding one or two sections one above the
// other, each section holding tabs. Pure data and pure functions: the screen's Workspace draws it, lib/prefs keeps it

export type TabId = string;

export type Section = {
  id: string;
  tabs: TabId[];
  active: TabId | null;
  collapsed: boolean;
  /** just added from the top bar: it waits for its first tab and goes away if it gets none */
  pending?: true;
};

export type Column = {
  sections: Section[];
  /** px; null: the column takes the room left */
  width: number | null;
  /** the top section's share of the column's height, in percent (two sections only); null: half */
  split: number | null;
};

export type Layout = { columns: Column[] };

export const LIMITS = { min: 2, max: 4, perColumn: 2 } as const;
export const NEW_COLUMN_WIDTH = 320;
export const COLUMN_WIDTH = { min: 220, max: 960 } as const;
export const SPLIT = { min: 20, max: 80 } as const;

export type Target =
  | { kind: "tabs"; section: string; index: number }
  | { kind: "split"; section: string; where: "above" | "below" }
  | { kind: "column"; column: number; side: "left" | "right" };

export type Direction = "left" | "right" | "up" | "down";

export const REFUSED = {
  fewest: "2 sections at least",
  most: "4 sections at most",
  column: "2 sections per column at most",
  same: "It is already there",
} as const;

export const allSections = (l: Layout): Section[] => l.columns.flatMap((c) => c.sections);
export const sectionCount = (l: Layout): number => allSections(l).length;

export function locate(l: Layout, sectionId: string): { column: number; row: number } | null {
  for (let column = 0; column < l.columns.length; column++) {
    const row = l.columns[column].sections.findIndex((s) => s.id === sectionId);
    if (row >= 0) return { column, row };
  }
  return null;
}

export const sectionOf = (l: Layout, tab: TabId): Section | undefined =>
  allSections(l).find((s) => s.tabs.includes(tab));

export const findSection = (l: Layout, id: string): Section | undefined => allSections(l).find((s) => s.id === id);

/** a column is drawn as a strip when every section it holds is collapsed */
export const columnCollapsed = (c: Column): boolean => c.sections.every((s) => s.collapsed);

const clone = (l: Layout): Layout => ({
  columns: l.columns.map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, tabs: [...s.tabs] })) })),
});

function nextId(l: Layout): string {
  const used = new Set(allSections(l).map((s) => s.id));
  let n = used.size + 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

// ponytail: empty sections leave (a pending one stays until it gets a tab or is dismissed), empty columns leave, the
// active tab is one the section holds, a column of one section has no split
function tidy(l: Layout): Layout {
  const columns = l.columns
    .map((c) => {
      const sections = c.sections
        .filter((s) => s.tabs.length > 0 || s.pending)
        .map((s): Section => {
          const kept: Section = {
            id: s.id,
            tabs: s.tabs,
            active: s.active && s.tabs.includes(s.active) ? s.active : (s.tabs[0] ?? null),
            collapsed: s.collapsed,
          };
          return s.pending && !s.tabs.length ? { ...kept, pending: true } : kept;
        });
      return { ...c, sections, split: sections.length === 2 ? c.split : null };
    })
    .filter((c) => c.sections.length > 0);
  return { columns };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function shapeOf(raw: unknown): Layout | null {
  if (!isObj(raw) || !Array.isArray(raw.columns)) return null;
  const columns: Column[] = [];
  for (const c of raw.columns) {
    if (!isObj(c) || !Array.isArray(c.sections)) return null;
    const sections: Section[] = [];
    for (const s of c.sections) {
      if (!isObj(s) || typeof s.id !== "string" || !Array.isArray(s.tabs)) return null;
      sections.push({
        id: s.id,
        tabs: s.tabs.filter((t): t is string => typeof t === "string"),
        active: typeof s.active === "string" ? s.active : null,
        collapsed: s.collapsed === true,
      });
    }
    columns.push({
      sections,
      width: typeof c.width === "number" && Number.isFinite(c.width) ? clampWidth(c.width) : null,
      split: typeof c.split === "number" && Number.isFinite(c.split) ? clampSplit(c.split) : null,
    });
  }
  return { columns };
}

const clampWidth = (px: number) => Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, px)));
const clampSplit = (pct: number) => Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, pct)));

/** what a kept layout becomes for the tabs a screen has now: unknown tabs go, missing ones join the last section,
 * the limits hold; anything it cannot make sense of is the screen's own layout */
export function normalize(raw: unknown, tabs: TabId[], fallback: Layout): Layout {
  const shaped = shapeOf(raw);
  if (!shaped) return tidy(fallback);
  const known = new Set(tabs);
  const seen = new Set<TabId>();
  const ids = new Set<string>();
  for (const c of shaped.columns)
    for (const s of c.sections) {
      if (ids.has(s.id)) s.id = `${s.id}-${ids.size}`;
      ids.add(s.id);
      s.tabs = s.tabs.filter((t) => known.has(t) && !seen.has(t) && seen.add(t));
    }
  let l = tidy(shaped);
  // ponytail: more than the column allows, or more than the screen allows — the extra sections' tabs join the last kept one
  for (const c of l.columns)
    while (c.sections.length > LIMITS.perColumn) {
      const extra = c.sections.pop() as Section;
      c.sections[c.sections.length - 1].tabs.push(...extra.tabs);
    }
  while (sectionCount(l) > LIMITS.max) {
    const last = l.columns[l.columns.length - 1];
    const extra = last.sections.pop() as Section;
    const into = l.columns[l.columns.length - 2] ?? last;
    into.sections[into.sections.length - 1].tabs.push(...extra.tabs);
    l = tidy(l);
  }
  const missing = tabs.filter((t) => !seen.has(t));
  if (missing.length) {
    const all = allSections(l);
    if (!all.length) return tidy(fallback);
    all[all.length - 1].tabs.push(...missing);
  }
  if (sectionCount(l) < Math.min(LIMITS.min, tabs.length)) return tidy(fallback);
  return tidy(l);
}

/** why a tab cannot go there, or null when it can */
export function refusal(l: Layout, tab: TabId, target: Target): string | null {
  const from = sectionOf(l, tab);
  if (!from) return REFUSED.same;
  if (target.kind === "tabs") {
    if (target.section === from.id) return null;
    if (!findSection(l, target.section)) return REFUSED.same;
  }
  const leaves = from.tabs.length === 1;
  const creates = target.kind !== "tabs";
  if (creates && leaves) {
    if (target.kind === "split" && target.section === from.id) return REFUSED.same;
    const at = locate(l, from.id);
    if (target.kind === "column" && at && l.columns[at.column].sections.length === 1) {
      const next = target.side === "left" ? target.column : target.column + 1;
      if (next === at.column || next === at.column + 1) return REFUSED.same;
    }
  }
  const count = sectionCount(l) - (leaves ? 1 : 0) + (creates ? 1 : 0);
  if (count < LIMITS.min) return REFUSED.fewest;
  if (count > LIMITS.max) return REFUSED.most;
  if (target.kind === "split") {
    const at = locate(l, target.section);
    if (!at) return REFUSED.same;
    const inColumn =
      l.columns[at.column].sections.length - (leaves && locate(l, from.id)?.column === at.column ? 1 : 0);
    if (inColumn + 1 > LIMITS.perColumn) return REFUSED.column;
  }
  return null;
}

/** the tab moved there (the caller asks refusal first); the section it leaves goes if it is left empty */
export function moveTab(l: Layout, tab: TabId, target: Target): Layout {
  if (refusal(l, tab, target)) return l;
  const next = clone(l);
  const from = sectionOf(next, tab) as Section;
  if (target.kind === "tabs" && target.section === from.id) {
    const at = from.tabs.indexOf(tab);
    from.tabs.splice(at, 1);
    from.tabs.splice(Math.min(target.index > at ? target.index - 1 : target.index, from.tabs.length), 0, tab);
    from.active = tab;
    return next;
  }
  const fresh = (): Section => ({ id: nextId(next), tabs: [tab], active: tab, collapsed: false });
  if (target.kind === "tabs") {
    const into = findSection(next, target.section) as Section;
    into.tabs.splice(Math.min(Math.max(0, target.index), into.tabs.length), 0, tab);
    into.active = tab;
    into.collapsed = false;
  } else if (target.kind === "split") {
    const at = locate(next, target.section) as { column: number; row: number };
    const column = next.columns[at.column];
    column.sections.splice(target.where === "above" ? at.row : at.row + 1, 0, fresh());
    column.split = null;
    for (const s of column.sections) s.collapsed = false;
  } else {
    const index = Math.min(next.columns.length, Math.max(0, target.column + (target.side === "right" ? 1 : 0)));
    next.columns.splice(index, 0, { sections: [fresh()], width: NEW_COLUMN_WIDTH, split: null });
  }
  from.tabs.splice(from.tabs.indexOf(tab), 1);
  if (from.active === tab) from.active = from.tabs[0] ?? null;
  return tidy(next);
}

/** why no section can be added that way, or null */
export function addRefusal(l: Layout, how: "column" | { split: string }): string | null {
  if (sectionCount(l) >= LIMITS.max) return REFUSED.most;
  if (how !== "column") {
    const at = locate(l, how.split);
    if (!at) return REFUSED.same;
    if (l.columns[at.column].sections.length >= LIMITS.perColumn) return REFUSED.column;
  }
  return null;
}

/** an empty section waiting for a tab: a new column on the right, or under a section */
export function addSection(l: Layout, how: "column" | { split: string }): Layout {
  if (addRefusal(l, how)) return l;
  const next = dropPending(clone(l));
  const section: Section = { id: nextId(next), tabs: [], active: null, collapsed: false, pending: true };
  if (how === "column") next.columns.push({ sections: [section], width: NEW_COLUMN_WIDTH, split: null });
  else {
    const at = locate(next, how.split) as { column: number; row: number };
    const column = next.columns[at.column];
    column.sections.splice(at.row + 1, 0, section);
    for (const s of column.sections) s.collapsed = false;
  }
  return next;
}

export const pendingSection = (l: Layout): Section | undefined => allSections(l).find((s) => s.pending);

export function dropPending(l: Layout): Layout {
  if (!pendingSection(l)) return l;
  return tidy({
    columns: l.columns.map((c) => ({ ...c, sections: c.sections.filter((s) => !s.pending) })),
  });
}

function update(l: Layout, sectionId: string, change: (s: Section) => Section): Layout {
  return {
    columns: l.columns.map((c) => ({ ...c, sections: c.sections.map((s) => (s.id === sectionId ? change(s) : s)) })),
  };
}

export const setActive = (l: Layout, sectionId: string, tab: TabId): Layout =>
  update(l, sectionId, (s) => (s.tabs.includes(tab) ? { ...s, active: tab, collapsed: false } : s));

export const setCollapsed = (l: Layout, sectionId: string, collapsed: boolean): Layout =>
  update(l, sectionId, (s) => ({ ...s, collapsed }));

/** the tab shown: its section opens on it */
export function reveal(l: Layout, tab: TabId): Layout {
  const s = sectionOf(l, tab);
  if (!s || (s.active === tab && !s.collapsed)) return l;
  return setActive(l, s.id, tab);
}

export const resizeColumn = (l: Layout, column: number, width: number): Layout => ({
  columns: l.columns.map((c, i) => (i === column ? { ...c, width: clampWidth(width) } : c)),
});

export const resizeSplit = (l: Layout, column: number, share: number): Layout => ({
  columns: l.columns.map((c, i) => (i === column && c.sections.length === 2 ? { ...c, split: clampSplit(share) } : c)),
});

/** where a tab goes with Alt Shift and an arrow: the next section that way, or a new column at the edge */
export function neighbor(l: Layout, sectionId: string, dir: Direction): Target | null {
  const at = locate(l, sectionId);
  if (!at) return null;
  if (dir === "up" || dir === "down") {
    const row = at.row + (dir === "down" ? 1 : -1);
    const other = l.columns[at.column].sections[row];
    if (other) return { kind: "tabs", section: other.id, index: other.tabs.length };
    return { kind: "split", section: sectionId, where: dir === "down" ? "below" : "above" };
  }
  const column = at.column + (dir === "right" ? 1 : -1);
  const beside = l.columns[column];
  if (beside) {
    const s = beside.sections[Math.min(at.row, beside.sections.length - 1)];
    return { kind: "tabs", section: s.id, index: s.tabs.length };
  }
  return { kind: "column", column: at.column, side: dir };
}

/** a screen's own layout, written as columns of sections: layoutOf(column(null, section(["test"])), …) */
export const section = (tabs: TabId[], collapsed = false): Section => ({
  id: "",
  tabs,
  active: tabs[0] ?? null,
  collapsed,
});

export const column = (width: number | null, ...sections: Section[]): Column => ({ sections, width, split: null });

export function layoutOf(...columns: Column[]): Layout {
  let n = 0;
  return { columns: columns.map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, id: `s${++n}` })) })) };
}
