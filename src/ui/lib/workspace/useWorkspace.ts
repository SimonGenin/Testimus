import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BadgeTone } from "../../components/ui/Badge.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { type PrefName, readPref, writePref } from "../prefs.ts";
import {
  addRefusal,
  addSection,
  dropPending,
  type Layout,
  moveTab,
  normalize,
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

export type AddHow = "column" | { split: string };

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
  /** live while dragging; commit keeps it */
  resizeColumn: (column: number, px: number, commit: boolean) => void;
  resizeSplit: (column: number, pct: number, commit: boolean) => void;
  reveal: (tab: TabId) => void;
  reset: () => void;
};

// ponytail: a screen's sections — the layout kept in lib/prefs under the screen's own key, read once and checked
// against the tabs the screen has now, written each time a gesture ends (not at each pixel of a drag); the shell's
// asks (show Claude, Ctrl J) reach the screen shown
export function useWorkspace({
  pref,
  label,
  tabs,
  defaults,
}: {
  pref: LayoutPref;
  label: string;
  tabs: WorkspaceTab[];
  defaults: Layout;
}): WorkspaceController {
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

  useEffect(() => {
    setLayout((l) => normalize(l, ids, fallback.current));
  }, [ids]);

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
      resizeColumn: (column, px, commit) => apply((l) => resizeColumn(l, column, px), commit),
      resizeSplit: (column, pct, commit) => apply((l) => resizeSplit(l, column, pct), commit),
      reveal: (tab) => {
        apply((l) => reveal(l, tab));
        show(tab);
      },
      reset: () => apply(() => normalize(null, ids, fallback.current)),
    }),
    [label, layout, tabs, byId, focused, apply, ids, show],
  );
}
