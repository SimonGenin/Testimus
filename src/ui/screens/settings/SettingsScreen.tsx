import * as stylex from "@stylexjs/stylex";
import { type ComponentType, useEffect, useRef } from "react";
import { NoProject } from "../../components/shell/NoProject.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { usePaneWidth } from "../../lib/panes.ts";
import { border, breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { AccessSection } from "./AccessSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { ClaudeSection } from "./ClaudeSection.tsx";
import { ColumnsSection } from "./ColumnsSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { ProjectSection } from "./ProjectSection.tsx";
import { SearchSection } from "./SearchSection.tsx";
import { Section } from "./Section.tsx";

const styles = stylex.create({
  screen: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 },
  frame: { display: "flex", flex: 1, minHeight: 0 },
  nav: {
    boxSizing: "border-box",
    flexShrink: 0,
    overflowY: "auto",
    paddingBlock: space.s3,
    paddingInline: 0,
    backgroundColor: color.surface,
    borderRightStyle: "solid",
    borderRightWidth: border.width,
    borderRightColor: color.border,
  },
  navWidth: (px: number) => ({ width: `${px}px` }),
  navFold: { maxWidth: { default: "none", [breakpoint.sm]: `calc(${size.sidebar} * 3 / 5)` } },
  body: { flex: 1, minWidth: 0, overflowY: "auto", backgroundColor: color.canvas },
  saved: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textSubtle,
  },
  waits: { color: color.textMuted },
});

type Page = { id: string; label: string; icon: IconName; page: ComponentType; needsProject: boolean };

const SECTIONS: Page[] = [
  { id: "project", label: "Project", icon: "folder", page: ProjectSection, needsProject: true },
  { id: "columns", label: "Smart columns", icon: "columns", page: ColumnsSection, needsProject: true },
  { id: "claude", label: "Claude", icon: "claude", page: ClaudeSection, needsProject: false },
  { id: "search", label: "Search", icon: "search", page: SearchSection, needsProject: true },
  { id: "models", label: "Models", icon: "cpu", page: ModelsSection, needsProject: false },
  { id: "access", label: "Access", icon: "key", page: AccessSection, needsProject: false },
  { id: "appearance", label: "Appearance", icon: "sun", page: AppearanceSection, needsProject: false },
];

const NAV = { min: 160, max: 360, initial: 240 };

// ponytail: one page per section, the list names the sections only; #/settings/<section>[-<card>] opens the section
// and scrolls to the card (a field id is focused)
export function SettingsScreen() {
  const app = useApp();
  const nav = usePaneWidth("settingsNavWidth", NAV);
  const arg = app.route.screen === "settings" ? (app.route.arg ?? "") : "";
  const section = SECTIONS.find((s) => s.id === arg.split("-")[0]) ?? SECTIONS[0];
  const Page = section.page;
  const body = useRef<HTMLDivElement>(null);
  const hasProject = !!app.info;
  // ponytail: a card shows once its read has answered — the screen waits for it to appear before scrolling to it
  useEffect(() => {
    const root = body.current;
    if (!arg || !root || !/^[\w-]+$/.test(arg)) return;
    const go = () => {
      const el = root.querySelector(`#settings-${arg}`);
      if (!el) return false;
      const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      el.scrollIntoView?.({ block: field ? "center" : "start" });
      if (field) el.focus();
      return true;
    };
    if (go()) return;
    const seen = new MutationObserver(() => {
      if (go()) seen.disconnect();
    });
    seen.observe(root, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [arg]);

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader
        title="Settings"
        badge={
          <>
            <span {...stylex.props(type.code)}>
              <Badge label={`v${__VERSION__}`} outline />
            </span>
            <span {...stylex.props(type.small, styles.saved)}>
              <Icon name="check" size="sm" />
              Changes save as you make them
            </span>
          </>
        }
      />
      <div {...stylex.props(styles.frame)}>
        <nav aria-label="Settings sections" {...stylex.props(styles.nav, styles.navWidth(nav.width), styles.navFold)}>
          <List
            label="Settings sections"
            items={SECTIONS}
            getKey={(s) => s.id}
            selected={section.id}
            onSelect={(id) => app.navigate("settings", id)}
            renderItem={(s) => {
              const waits = !hasProject && s.needsProject;
              return {
                title: waits ? <span {...stylex.props(styles.waits)}>{s.label}</span> : s.label,
                lead: <Icon name={s.icon} />,
                trail: waits ? "needs a project" : undefined,
              };
            }}
          />
        </nav>
        <ResizeHandle label="Resize the section list" {...nav.handle} />
        <div ref={body} key={section.id} {...stylex.props(styles.body)}>
          {!hasProject && section.needsProject ? (
            <Section id={section.id} title={section.label}>
              <Card padded={false}>
                <NoProject text="Open a project to change its settings. Claude, Models, Access and Appearance work without one." />
              </Card>
            </Section>
          ) : (
            <Page />
          )}
        </div>
      </div>
    </div>
  );
}
