import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useLayoutEffect, useRef } from "react";
import { type Direction, locate, neighbor, type Section, type Target } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { border, color, size, space } from "../../../styles/tokens.stylex.ts";
import { Button } from "../Button.tsx";
import type { IconName } from "../Icon.tsx";
import { Menu, type MenuEntry } from "../Menu.tsx";
import { SectionTab } from "./SectionTab.tsx";
import type { TabDragHandle } from "./useTabDrag.ts";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "flex-end",
    gap: space.s1,
    height: size.controlLg,
    paddingInlineStart: space.snug,
    paddingInlineEnd: space.s2,
    backgroundColor: color.surfaceSunken,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    minWidth: 0,
  },
  tabs: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.s1,
    minWidth: 0,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  rest: { flex: 1, alignSelf: "stretch", minWidth: space.s3 },
  tools: { flex: "none", alignSelf: "center", display: "flex", alignItems: "center", gap: space.s1 },
});

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export const tabDomId = (prefix: string, tab: string) => `${prefix}-tab-${tab}`;
export const panelDomId = (prefix: string, tab: string) => `${prefix}-panel-${tab}`;

// ponytail: a section's head — its tabs (the arrows go from one to the next, Alt Shift and an arrow sends the tab shown
// to the next section that way), the section's menu (the same moves for the mouse, collapse, reset) and its fold;
// double-clicking the empty part folds it too
export function SectionTabs({
  ws,
  section,
  prefix,
  drag,
  fold,
}: {
  ws: WorkspaceController;
  section: Section;
  prefix: string;
  drag: TabDragHandle;
  /** the fold's look: a column folds to its side, a section of a split column to its bar */
  fold: { icon: IconName; label: string };
}) {
  const active = section.active ? ws.tab(section.active) : undefined;
  const list = useRef<HTMLDivElement>(null);
  // ponytail: the tab shown is in view in its strip — one offered beside the work (a job, a source) arrives last, past
  // the edge of a narrow section
  useLayoutEffect(() => {
    const l = list.current;
    const t = section.active ? document.getElementById(tabDomId(prefix, section.active)) : null;
    if (!l || !t) return;
    const lr = l.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    if (tr.right > lr.right) l.scrollLeft += tr.right - lr.right;
    else if (tr.left < lr.left) l.scrollLeft -= lr.left - tr.left;
  }, [section.active, prefix]);
  const send = (tab: string, to: Target | null) => to && ws.move(tab, to);
  const keys = (tab: string, e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROWS[e.key];
    if (dir && e.altKey && e.shiftKey) {
      e.preventDefault();
      send(tab, neighbor(ws.layout, section.id, dir));
      requestAnimationFrame(() => document.getElementById(tabDomId(prefix, tab))?.focus());
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const at = section.tabs.indexOf(tab);
    const n = section.tabs.length;
    const to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    const next = section.tabs[to];
    ws.select(section.id, next);
    document.getElementById(tabDomId(prefix, next))?.focus();
  };
  const at = locate(ws.layout, section.id);
  const others = ws.layout.columns.flatMap((c, ci) =>
    c.sections.filter((s) => s.id !== section.id).map((s) => ({ s, ci })),
  );
  const moveEntries = (tab: string): MenuEntry[] => {
    const entry = (label: string, to: Target): MenuEntry => ({
      label,
      disabled: ws.refusal(tab, to) ?? false,
      onSelect: () => ws.move(tab, to),
    });
    return [
      { group: `Move « ${ws.tab(tab)?.label ?? tab} » to` },
      ...others.map(({ s, ci }) =>
        entry(
          `Section ${ci + 1}${ws.layout.columns[ci].sections.length > 1 ? (ws.layout.columns[ci].sections[0] === s ? " (top)" : " (bottom)") : ""} · ${ws.tab(s.active ?? "")?.label ?? "empty"}`,
          { kind: "tabs", section: s.id, index: s.tabs.length },
        ),
      ),
      entry("A new column on the right", { kind: "column", column: at?.column ?? 0, side: "right" }),
      entry("A new section below", { kind: "split", section: section.id, where: "below" }),
    ];
  };
  const entries: MenuEntry[] = [
    ...(active ? moveEntries(active.id) : []),
    "separator",
    {
      label: section.collapsed ? "Expand this section" : "Collapse this section",
      shortcut: "Ctrl Shift B",
      onSelect: () => ws.collapse(section.id, !section.collapsed),
    },
    { label: `Reset the layout of ${ws.label}`, onSelect: ws.reset },
  ];
  return (
    <div data-ws-bar="" {...stylex.props(styles.bar)}>
      <div
        ref={list}
        role="tablist"
        aria-label={`Section ${at ? at.column + 1 : ""}${active ? ` · ${active.label}` : ""}`}
        {...stylex.props(styles.tabs)}
      >
        {section.tabs.map((id) => {
          const t = ws.tab(id);
          if (!t) return null;
          return (
            <SectionTab
              key={id}
              id={tabDomId(prefix, id)}
              panelId={panelDomId(prefix, id)}
              label={t.label}
              icon={t.icon}
              count={t.count}
              claude={t.claude}
              active={section.active === id && !section.collapsed}
              lifted={drag.drag?.tab === id}
              onSelect={() => {
                if (drag.swallowClick()) return;
                ws.focus(section.id);
                ws.select(section.id, id);
                document.getElementById(tabDomId(prefix, id))?.focus();
              }}
              onPress={(e) => drag.onPointerDown(id, e)}
              onKeyDown={(e) => keys(id, e)}
            />
          );
        })}
      </div>
      <span
        aria-hidden="true"
        {...stylex.props(styles.rest)}
        onDoubleClick={() => ws.collapse(section.id, !section.collapsed)}
      />
      <span {...stylex.props(styles.tools)}>
        <Menu
          label="Section menu"
          align="end"
          entries={entries}
          trigger={<Button variant="quiet" size="sm" icon="more" iconOnly label="Section menu" />}
        />
        <Button
          variant="quiet"
          size="sm"
          icon={fold.icon}
          iconOnly
          label={section.collapsed ? "Expand this section" : fold.label}
          onClick={() => ws.collapse(section.id, !section.collapsed)}
        />
      </span>
    </div>
  );
}
