import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BadgeTone } from "../../components/ui/Badge.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { type PrefName, readPref, writePref } from "../prefs.ts";
import {
  addRefusal,
  addSection,
  collapseColumn,
  dropPending,
  type Layout,
  moveTab,
  normalize,
  place,
  refusal,
  resizeColumn,
  resizeSplit,
  reveal,
  sectionOf,
  setActive,
  setCollapsed,
  type TabId,
  type Target,
} from "./layout.ts";
import { useRevealAsk } from "./signals.ts";

export type LayoutPref = Extract<PrefName, `layout${string}`>;

/** one tab of a screen: what it is (its icon is required — a collapsed section is read from its icons), what it holds */
export type WorkspaceTab = {
  id: TabId;
  label: string;
  icon: IconName;
  /** the screen's work (the test reviewed, the step played): its column takes the room left and folds last */
  main?: boolean;
  /** Claude's own tab: its name in violet */
  claude?: boolean;
  /** how many wait there (on the tab and on its icon when collapsed) */
  count?: number;
  /** a state dot on its icon when collapsed (Claude working, a finding) */
  dot?: BadgeTone;
  content: ReactNode;
  /** the section's foot while this tab shows: its actions and its state, at the bottom, always in view */
  footer?: ReactNode;
};

/** a tab a piece of a screen opens beside its work while it needs it (a test's analysis) — never the work itself; its
 * foot is in its content. One with the id of a screen's own tab shows in that tab's place while it is offered (a
 * source opened in Review's Source tab) */
export type SideTab = Omit<WorkspaceTab, "main" | "footer">;

const sameTab = (a: SideTab, b: SideTab) =>
  a.label === b.label &&
  a.icon === b.icon &&
  a.count === b.count &&
  a.dot === b.dot &&
  a.claude === b.claude &&
  a.content === b.content;

export type AddHow = "column" | { split: string };

export type ColumnSize = { column: number; width: number };

const sized = (l: Layout, sizes: ColumnSize[]) => sizes.reduce((at, s) => resizeColumn(at, s.column, s.width), l);

export type WorkspaceController = {
  /** the screen's name (« Review »): the controls and the reset say it */
  label: string;
  layout: Layout;
  tabs: WorkspaceTab[];
  tab: (id: TabId) => WorkspaceTab | undefined;
  /** the section in use (the last one clicked or focused): Split and the keys act on it */
  focused: string | null;
  focus: (sectionId: string) => void;
  select: (sectionId: string, tab: TabId) => void;
  collapse: (sectionId: string, collapsed: boolean) => void;
  refusal: (tab: TabId, target: Target) => string | null;
  move: (tab: TabId, target: Target) => boolean;
  addRefusal: (how: AddHow) => string | null;
  add: (how: AddHow) => void;
  /** the empty section just added goes */
  dismiss: () => void;
  /** live while dragging; commit keeps it — the columns an edge moves, in one change */
  resizeColumns: (sizes: ColumnSize[], commit: boolean) => void;
  resizeSplit: (column: number, pct: number, commit: boolean) => void;
  /** a column dragged past its least width folds; the columns the drag resized get back the widths they had */
  foldColumn: (column: number, keep: ColumnSize[]) => void;
  /** a section of a split column dragged past its least height folds to its tab bar; the share it had stays */
  foldSplit: (column: number, row: number, share: number) => void;
  reveal: (tab: TabId) => void;
  reset: () => void;
  /** a side tab arrives (placed beside the work, lib/workspace place) or changes; its content should not change at
   * each render (a slot its owner draws into) */
  offer: (tab: SideTab) => void;
  /** the side tab goes; the section it was in is where it comes back */
  withdraw: (tab: TabId) => void;
};

// ponytail: a screen's sections — the layout kept in lib/prefs under the screen's own key, read once and checked
// against the tabs the screen has now, written each time a gesture ends (not at each pixel of a drag); the shell's
// asks (show Claude, Ctrl J) reach the screen shown
export function useWorkspace({
  pref,
  label,
  tabs: own,
  defaults,
}: {
  pref: LayoutPref;
  label: string;
  tabs: WorkspaceTab[];
  defaults: Layout;
}): WorkspaceController {
  const [side, setSide] = useState<SideTab[]>([]);
  const tabs = useMemo(
    () => [
      ...own.map((o) => side.find((t) => t.id === o.id) ?? o),
      ...side.filter((t) => !own.some((o) => o.id === t.id)),
    ],
    [own, side],
  );
  const key = tabs.map((t) => t.id).join(" ");
  const ids = useMemo(() => key.split(" "), [key]);
  const fallback = useRef(defaults);
  fallback.current = defaults;
  const [layout, setLayout] = useState(() => normalize(readPref(pref), ids, defaults));
  const [focused, setFocused] = useState<string | null>(null);
  const dirty = useRef(false);
  const current = useRef(layout);
  current.current = layout;
  // ponytail: a tab shown on request takes the focus, so a narrow window folds another column rather than this one
  const show = useCallback((tab: TabId) => {
    const s = sectionOf(current.current, tab);
    if (s) setFocused(s.id);
  }, []);

  const main = own.find((t) => t.main)?.id;
  const sideIds = useRef<TabId[]>([]);
  sideIds.current = side.map((t) => t.id);
  const was = useRef(new Map<TabId, string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed when the screen's tabs change, from the layout now
  useEffect(() => {
    const l = current.current;
    for (const s of l.columns.flatMap((c) => c.sections))
      for (const t of s.tabs) if (!ids.includes(t)) was.current.set(t, s.id);
    const fresh = sideIds.current.filter((t) => !sectionOf(l, t));
    const next = normalize(
      fresh.reduce((at, t) => place(at, t, main, was.current.get(t)), l),
      ids,
      fallback.current,
    );
    setLayout(next);
    const shown = fresh.length ? sectionOf(next, fresh[fresh.length - 1]) : undefined;
    if (shown) setFocused(shown.id);
  }, [ids]);

  const offer = useCallback(
    (tab: SideTab) =>
      setSide((list) => {
        const i = list.findIndex((t) => t.id === tab.id);
        if (i < 0) return [...list, tab];
        return sameTab(list[i], tab) ? list : list.map((t, j) => (j === i ? tab : t));
      }),
    [],
  );
  const withdraw = useCallback((id: TabId) => setSide((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    writePref(pref, dropPending(layout));
  }, [layout, pref]);

  const apply = useCallback((change: (l: Layout) => Layout, keep = true) => {
    setLayout((l) => {
      const next = change(l);
      if (next !== l && keep) dirty.current = true;
      return next;
    });
  }, []);

  const ask = useRevealAsk();
  const handled = useRef(ask?.nonce ?? 0);
  useEffect(() => {
    if (!ask || ask.nonce === handled.current) return;
    handled.current = ask.nonce;
    if (!ids.includes(ask.tab)) return;
    apply((l) => {
      const s = sectionOf(l, ask.tab);
      if (ask.toggle && s && s.active === ask.tab && !s.collapsed) return setCollapsed(l, s.id, true);
      return reveal(l, ask.tab);
    });
    show(ask.tab);
  }, [ask, ids, apply, show]);

  const byId = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  return useMemo<WorkspaceController>(
    () => ({
      label,
      layout,
      tabs,
      tab: (id) => byId.get(id),
      focused,
      focus: setFocused,
      select: (sectionId, tab) => apply((l) => setActive(l, sectionId, tab)),
      collapse: (sectionId, collapsed) => apply((l) => setCollapsed(l, sectionId, collapsed)),
      refusal: (tab, target) => refusal(layout, tab, target),
      move: (tab, target) => {
        if (refusal(layout, tab, target)) return false;
        apply((l) => moveTab(l, tab, target));
        return true;
      },
      addRefusal: (how) => addRefusal(layout, how),
      add: (how) => apply((l) => addSection(l, how), false),
      dismiss: () => apply(dropPending, false),
      resizeColumns: (sizes, commit) => apply((l) => sized(l, sizes), commit),
      resizeSplit: (column, pct, commit) => apply((l) => resizeSplit(l, column, pct), commit),
      foldColumn: (column, keep) => apply((l) => collapseColumn(sized(l, keep), column)),
      foldSplit: (column, row, share) =>
        apply((l) => {
          const s = l.columns[column]?.sections[row];
          return s ? setCollapsed(resizeSplit(l, column, share), s.id, true) : l;
        }),
      reveal: (tab) => {
        apply((l) => reveal(l, tab));
        show(tab);
      },
      reset: () => apply(() => normalize(null, ids, fallback.current)),
      offer,
      withdraw,
    }),
    [label, layout, tabs, byId, focused, apply, ids, show, offer, withdraw],
  );
}
