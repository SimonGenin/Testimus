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

const SECTIONS = [
  { id: "project", label: "Project" },
  { id: "fields", label: "Step fields" },
  { id: "claude", label: "Claude" },
  { id: "search", label: "Search" },
  { id: "models", label: "Models" },
  { id: "access", label: "Access" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsScreen() {
  const app = useApp();
  const at = app.route.screen === "settings" ? (app.route.arg ?? "project") : "project";
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!app.route.arg) return;
    body.current?.querySelector(`#settings-${app.route.arg}`)?.scrollIntoView?.({ block: "start" });
  }, [app.route.arg]);
  return (
    <div className="screen">
      <ScreenHeader title="Settings" meta="Changes are saved as you make them" />
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
