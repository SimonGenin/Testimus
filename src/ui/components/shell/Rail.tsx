import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import { type Screen, useApp } from "../../lib/app.ts";
import { draftOf, keepDraft } from "../../lib/drafts.ts";
import { APP_VERSION } from "../../lib/version.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { Logo } from "../ui/Logo.tsx";
import { RailItem } from "../ui/RailItem.tsx";
import { ProjectButton } from "./ProjectButton.tsx";
import { SystemStatus } from "./SystemStatus.tsx";

export const NAV: { id: Screen; label: string; icon: IconName }[] = [
  { id: "documents", label: "Documents", icon: "documents" },
  { id: "generate", label: "Generate", icon: "generate" },
  { id: "review", label: "Review", icon: "review" },
  { id: "tests", label: "Tests", icon: "tests" },
  { id: "run", label: "Run", icon: "play" },
  { id: "jobs", label: "Jobs", icon: "jobs" },
];

const styles = stylex.create({
  rail: {
    flex: "none",
    width: `calc(${size.controlMd} + 2 * ${space.s3})`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s4,
    backgroundColor: color.canvas,
    overflowY: "auto",
    overflowX: "hidden",
  },
  logo: { flex: "none", display: "flex", marginBottom: space.s5 },
  gap: { flex: "none", height: space.s3 },
  spacer: { flex: 1 },
  version: { flex: "none", display: "flex" },
});

// ponytail: the main navigation, icons only (each one's name in its tooltip and its accessible name) — the project on
// top, the work screens, then Jobs, Settings, the system's state and the version under it, which opens Settings ›
// Changelog (the theme is chosen in Settings); coming back to a screen from the rail opens what was open there, its own
// entry clicked again goes to its start
export function Rail({ counts, kit = false }: { counts: Partial<Record<Screen, number>>; kit?: boolean }) {
  const app = useApp();
  const at = app.route.screen;
  const arg = app.route.arg;
  useEffect(() => keepDraft(`route.${at}`, arg), [at, arg]);
  const go = (s: Screen) => app.navigate(s, s === at ? undefined : draftOf<string>(`route.${s}`));
  const item = (id: Screen, label: string, icon: IconName) => (
    <RailItem
      key={id}
      compact
      label={label}
      icon={icon}
      current={at === id}
      count={counts[id]}
      onClick={() => go(id)}
    />
  );
  return (
    <nav aria-label="Main" {...stylex.props(styles.rail)}>
      <span {...stylex.props(styles.logo)}>
        <Logo label="Testimus" />
      </span>
      <ProjectButton />
      <span {...stylex.props(styles.gap)} />
      {NAV.filter((n) => n.id !== "jobs").map((n) => item(n.id, n.label, n.icon))}
      {kit && item("kit", "Kit", "kit")}
      <span {...stylex.props(styles.spacer)} />
      {item("jobs", "Jobs", "jobs")}
      {item("settings", "Settings", "settings")}
      <SystemStatus current={at === "doctor"} onOpen={() => go("doctor")} />
      <span {...stylex.props(styles.version)}>
        <Button
          variant="quiet"
          size="sm"
          icon="history"
          iconOnly
          label={`Testimus ${APP_VERSION} · what's new`}
          onClick={() => app.navigate("settings", "changelog")}
        />
      </span>
    </nav>
  );
}
