import { useEffect } from "react";
import { type Screen, useApp } from "../../lib/app.ts";
import { draftOf, keepDraft } from "../../lib/drafts.ts";
import type { IconName } from "../legacy/index.ts";
import { ProjectButton } from "./ProjectButton.tsx";
import { RailItem } from "./RailItem.tsx";
import { SystemStatus } from "./SystemStatus.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export const NAV: { id: Screen; label: string; icon: IconName }[] = [
  { id: "documents", label: "Documents", icon: "documents" },
  { id: "generate", label: "Generate", icon: "generate" },
  { id: "review", label: "Review", icon: "review" },
  { id: "tests", label: "Tests", icon: "tests" },
  { id: "jobs", label: "Jobs", icon: "jobs" },
];

export function Rail({ counts }: { counts: Partial<Record<Screen, number>> }) {
  const app = useApp();
  const at = app.route.screen;
  const arg = app.route.arg;
  // ponytail: coming back to a screen from the rail opens what was open there; its own entry, clicked again, goes to
  // its start as before
  useEffect(() => keepDraft(`route.${at}`, arg), [at, arg]);
  const go = (s: Screen) => app.navigate(s, s === at ? undefined : draftOf<string>(`route.${s}`));
  return (
    <nav className="rail" aria-label="Main">
      <img className="rail-logo" src="/logo.png" alt="Testimus" />
      <ProjectButton />
      <div className="rail-sep" />
      {NAV.filter((n) => n.id !== "jobs").map((n) => (
        <RailItem
          key={n.id}
          label={n.label}
          icon={n.icon}
          current={at === n.id}
          count={counts[n.id]}
          onClick={() => go(n.id)}
        />
      ))}
      <div className="rail-spacer" />
      <RailItem label="Jobs" icon="jobs" current={at === "jobs"} count={counts.jobs} onClick={() => go("jobs")} />
      <RailItem label="Settings" icon="settings" current={at === "settings"} onClick={() => go("settings")} />
      <ThemeToggle />
      <SystemStatus current={at === "doctor"} onOpen={() => go("doctor")} />
    </nav>
  );
}
