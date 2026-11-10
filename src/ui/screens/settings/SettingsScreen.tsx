import * as stylex from "@stylexjs/stylex";
import { type ComponentType, useEffect, useRef } from "react";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { NoProject } from "../../components/shell/NoProject.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { useApp } from "../../lib/app.ts";
import { APP_VERSION } from "../../lib/version.ts";
import { column, layoutOf, section as sectionOf } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { AccessSection } from "./AccessSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { ChangelogSection } from "./ChangelogSection.tsx";
import { ClaudeCodeSection } from "./ClaudeCodeSection.tsx";
import { ClaudeSection } from "./ClaudeSection.tsx";
import { ColumnsSection } from "./ColumnsSection.tsx";
import { ContextSection } from "./ContextSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { ProjectSection } from "./ProjectSection.tsx";
import { SearchSection } from "./SearchSection.tsx";
import { Section } from "./Section.tsx";
import { UpdatesSection } from "./UpdatesSection.tsx";
import { VideosSection } from "./VideosSection.tsx";

const styles = stylex.create({
  screen: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 },
  nav: { boxSizing: "border-box", flex: 1, overflowY: "auto", paddingBlock: space.s3, paddingInline: 0 },
  body: { flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", backgroundColor: color.canvas },
  saved: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textSubtle,
  },
  waits: { color: color.textMuted },
});

type Page = { id: string; label: string; icon: IconName; page: ComponentType; needsProject: boolean };

// ponytail: two groups — what belongs to the open project (its folder), then Testimus itself on this PC, for every
// project; « claude » is this PC's Claude Code (the program, the agents), « claudeproject » what the project asks of
// Claude (the dock, the quick asks, the overview)
const PROJECT: Page[] = [
  { id: "project", label: "Project", icon: "folder", page: ProjectSection, needsProject: true },
  { id: "columns", label: "Smart columns", icon: "columns", page: ColumnsSection, needsProject: true },
  { id: "claudeproject", label: "Claude", icon: "claude", page: ClaudeSection, needsProject: true },
  { id: "context", label: "Context", icon: "context", page: ContextSection, needsProject: true },
  { id: "search", label: "Search", icon: "search", page: SearchSection, needsProject: true },
  { id: "videos", label: "Videos", icon: "play", page: VideosSection, needsProject: true },
];
const APP: Page[] = [
  { id: "claude", label: "Claude Code", icon: "terminal", page: ClaudeCodeSection, needsProject: false },
  { id: "access", label: "Jira and Xray", icon: "key", page: AccessSection, needsProject: false },
  { id: "models", label: "Models", icon: "cpu", page: ModelsSection, needsProject: false },
  { id: "appearance", label: "Appearance", icon: "sun", page: AppearanceSection, needsProject: false },
  { id: "updates", label: "Updates", icon: "download", page: UpdatesSection, needsProject: false },
  { id: "changelog", label: "Changelog", icon: "history", page: ChangelogSection, needsProject: false },
];
const SECTIONS = [...PROJECT, ...APP];

// ponytail: the sections on the left, the open one in the middle, Claude folded on the right
const LAYOUT = layoutOf(
  column(240, sectionOf(["sections"])),
  column(null, sectionOf(["page"])),
  column(400, sectionOf(["claude"], true)),
);

// ponytail: one page per section, the list names the sections only; #/settings/<section>[-<card>] opens the section
// and scrolls to the card (a field id is focused)
export function SettingsScreen() {
  const app = useApp();
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

  const claude = useClaudeTab();
  const ws = useWorkspace({
    pref: "layoutSettings",
    label: "Settings",
    defaults: LAYOUT,
    tabs: [
      {
        id: "sections",
        label: "Settings",
        icon: "settings",
        content: (
          <nav aria-label="Settings sections" {...stylex.props(styles.nav)}>
            <List
              label="Settings sections"
              items={SECTIONS}
              groups={[
                { label: "This project", keys: PROJECT.map((p) => p.id) },
                { label: "Testimus", keys: APP.map((p) => p.id) },
              ]}
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
        ),
      },
      {
        id: "page",
        label: section.label,
        icon: section.icon,
        main: true,
        content: (
          <div ref={body} key={section.id} {...stylex.props(styles.body)}>
            {!hasProject && section.needsProject ? (
              <Section id={section.id} title={section.label}>
                <Card padded={false}>
                  <NoProject text="Open a project to change its settings. Claude Code, Jira and Xray, Models, Appearance, Updates and Changelog work without one." />
                </Card>
              </Section>
            ) : (
              <Page />
            )}
          </div>
        ),
      },
      claude,
    ],
  });

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader
        title="Settings"
        badge={
          <>
            <span {...stylex.props(type.code)}>
              <Badge
                label={APP_VERSION}
                outline
                tooltip="What changed in each version"
                onClick={() => app.navigate("settings", "changelog")}
              />
            </span>
            <span {...stylex.props(type.small, styles.saved)}>
              <Icon name="check" size="sm" />
              Changes save as you make them
            </span>
          </>
        }
      />
      <Workspace ws={ws} />
    </div>
  );
}
