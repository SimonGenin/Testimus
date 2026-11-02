import { type Screen, useApp } from "../../lib/app.ts";
import type { IconName } from "../ui/index.ts";
import { ProjectButton } from "./ProjectButton.tsx";
import { RailItem } from "./RailItem.tsx";
import { SystemStatus } from "./SystemStatus.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export const NAV: { id: Screen; label: string; icon: IconName }[] = [
  { id: "documents", label: "Documents", icon: "documents" },
  { id: "generate", label: "Generate", icon: "generate" },
  { id: "tests", label: "Tests", icon: "tests" },
  { id: "review", label: "Review", icon: "review" },
  { id: "jobs", label: "Jobs", icon: "jobs" },
];

export function Rail({ counts }: { counts: Partial<Record<Screen, number>> }) {
  const app = useApp();
  const at = app.route.screen;
  return (
    <nav className="rail" aria-label="Main">
      <img className="rail-logo" src="/logo.png" alt="Testimus" />
      <ProjectButton />
      <div className="rail-sep" />
      {NAV.map((n) => (
        <RailItem
          key={n.id}
          label={n.label}
          icon={n.icon}
          current={at === n.id}
          count={counts[n.id]}
          onClick={() => app.navigate(n.id)}
        />
      ))}
      <div className="rail-spacer" />
      <ThemeToggle />
      <RailItem label="Settings" icon="settings" current={at === "settings"} onClick={() => app.navigate("settings")} />
      <SystemStatus current={at === "doctor"} onOpen={() => app.navigate("doctor")} />
    </nav>
  );
}
