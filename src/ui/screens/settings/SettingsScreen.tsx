import { useEffect, useRef } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { AccessSection } from "./AccessSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { ClaudeSection } from "./ClaudeSection.tsx";
import { FieldsSection } from "./FieldsSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { ProjectSection } from "./ProjectSection.tsx";
import { SearchSection } from "./SearchSection.tsx";
import { TracesSection } from "./TracesSection.tsx";

const SECTIONS = [
  { id: "project", label: "Project" },
  { id: "fields", label: "Step fields" },
  { id: "traces", label: "Tracked ids" },
  { id: "claude", label: "Claude" },
  { id: "search", label: "Search" },
  { id: "models", label: "Models" },
  { id: "access", label: "Access" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsScreen() {
  const app = useApp();
  const at = app.route.screen === "settings" ? (app.route.arg ?? "project").split("-")[0] : "project";
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
      <div className="settings">
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
        <div className="settings-body scroll" ref={body}>
          {!app.info && (
            <p className="muted">Open a project to change its settings: Access and Appearance work without one.</p>
          )}
          <ProjectSection />
          <FieldsSection />
          <TracesSection />
          <ClaudeSection />
          <SearchSection />
          <ModelsSection />
          <AccessSection />
          <AppearanceSection />
        </div>
      </div>
    </div>
  );
}
