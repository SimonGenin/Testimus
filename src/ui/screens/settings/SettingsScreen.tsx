import { type CSSProperties, useEffect, useRef } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { DragEdge } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { AccessSection } from "./AccessSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { ClaudeSection } from "./ClaudeSection.tsx";
import { ColumnsSection } from "./ColumnsSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { ProjectSection } from "./ProjectSection.tsx";
import { SearchSection } from "./SearchSection.tsx";

const SECTIONS = [
  { id: "project", label: "Project", page: ProjectSection, needsProject: true },
  { id: "columns", label: "Smart columns", page: ColumnsSection, needsProject: true },
  { id: "claude", label: "Claude", page: ClaudeSection, needsProject: false },
  { id: "search", label: "Search", page: SearchSection, needsProject: true },
  { id: "models", label: "Models", page: ModelsSection, needsProject: false },
  { id: "access", label: "Access", page: AccessSection, needsProject: false },
  { id: "appearance", label: "Appearance", page: AppearanceSection, needsProject: false },
];

export function SettingsScreen() {
  const app = useApp();
  const [navW, navEdge] = useSideWidth("testimus.settingsNavWidth", 160, 360, "before");
  const arg = app.route.screen === "settings" ? (app.route.arg ?? "project").split("-")[0] : "project";
  const section = SECTIONS.find((s) => s.id === arg) ?? SECTIONS[0];
  const at = section.id;
  const Page = section.page;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!app.route.arg) return;
    const el = body.current?.querySelector(`#settings-${app.route.arg}`);
    el?.scrollIntoView?.({ block: el instanceof HTMLInputElement ? "center" : "start" });
    if (el instanceof HTMLInputElement) el.focus();
  }, [app.route.arg]);
  return (
    <div className="screen">
      <ScreenHeader
        title="Settings"
        badge={<span className="version-pill">v{__VERSION__}</span>}
        meta="Changes are saved as you make them"
      />
      <div className="settings" style={navW ? ({ "--snav-size": `${navW}px` } as CSSProperties) : undefined}>
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cx("sub", at === s.id && "sub-on")}
              aria-current={at === s.id ? "true" : undefined}
              onClick={() => app.navigate("settings", s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <DragEdge className="side-edge" label="Resize the section list" {...navEdge} />
        <div className="settings-body scroll" ref={body} key={at}>
          {!app.info && section.needsProject && (
            <p className="muted">Open a project to change its settings: Access and Appearance work without one.</p>
          )}
          <Page />
        </div>
      </div>
    </div>
  );
}
