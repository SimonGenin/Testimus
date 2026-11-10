import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { Section } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { border, color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import type { IconName } from "../Icon.tsx";
import { DropZones } from "./DropZones.tsx";
import { SectionPicker } from "./SectionPicker.tsx";
import { panelDomId, SectionTabs, tabDomId } from "./SectionTabs.tsx";
import type { TabDragHandle } from "./useTabDrag.ts";

const styles = stylex.create({
  section: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  open: { flex: 1 },
  sized: (basis: string) => ({ flexGrow: 0, flexShrink: 0, flexBasis: basis }),
  folded: { flex: "none" },
  focused: { borderColor: color.borderStrong },
  gone: { display: "none" },
  pending: { borderStyle: "dashed", borderWidth: border.widthStrong, borderColor: color.accent },
  body: { position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  panel: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" },
  foot: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    height: size.cardHead,
    paddingInline: space.s4,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
});

// ponytail: one section — its tab bar, the tab shown (the others it has shown stay mounted, hidden: a half-typed ask
// or a scrolled list is where it was left), the tab's foot (always the same height, at the bottom, whatever scrolls
// above), what a tab dragged over it would do; folded, only its tab bar stays
export function WorkspaceSection({
  ws,
  section,
  prefix,
  drag,
  fold,
  basis,
  stowed = false,
}: {
  ws: WorkspaceController;
  section: Section;
  prefix: string;
  drag: TabDragHandle;
  fold: { icon: IconName; label: string };
  /** the share of its column's height (a split column), as a CSS length */
  basis?: string;
  /** its column is a strip: nothing shows, what its tabs hold stays mounted */
  stowed?: boolean;
}) {
  const [shown, setShown] = useState<string[]>(() =>
    section.active && !section.collapsed && !stowed ? [section.active] : [],
  );
  const active = section.active;
  useEffect(() => {
    if (active && !section.collapsed && !stowed) setShown((s) => (s.includes(active) ? s : [...s, active]));
  }, [active, section.collapsed, stowed]);
  const tab = active ? ws.tab(active) : undefined;
  const live = !section.collapsed && !stowed;
  const mounted = section.tabs.filter((id) => shown.includes(id) || (id === active && live));
  const over = drag.drag?.over?.section === section.id ? drag.drag.over : null;
  return (
    <div
      hidden={stowed}
      data-ws-section={section.id}
      onPointerDownCapture={() => ws.focus(section.id)}
      onFocusCapture={() => ws.focus(section.id)}
      {...stylex.props(
        styles.section,
        section.collapsed ? styles.folded : basis ? styles.sized(basis) : styles.open,
        ws.focused === section.id && styles.focused,
        section.pending && styles.pending,
        stowed && styles.gone,
      )}
    >
      <SectionTabs ws={ws} section={section} prefix={prefix} drag={drag} fold={fold} />
      {section.pending ? (
        <SectionPicker ws={ws} section={section} />
      ) : (
        mounted.length > 0 && (
          <div hidden={section.collapsed} {...stylex.props(styles.body, section.collapsed && styles.gone)}>
            {mounted.map((id) => (
              <div
                key={id}
                role="tabpanel"
                id={panelDomId(prefix, id)}
                aria-labelledby={tabDomId(prefix, id)}
                hidden={id !== active}
                {...stylex.props(styles.panel, id !== active && styles.gone)}
              >
                {ws.tab(id)?.content}
              </div>
            ))}
          </div>
        )
      )}
      {!section.collapsed && !section.pending && tab?.footer && <div {...stylex.props(styles.foot)}>{tab.footer}</div>}
      {over && <DropZones zone={over.zone} open={over.open} marker={over.marker} refused={over.refused} />}
    </div>
  );
}
