import { firstSentence, type PaletteAction } from "../components/shell/paletteEntries.tsx";
import { NAV } from "../components/shell/Rail.tsx";
import type { Screen } from "../lib/app.ts";
import type { CommandInfo } from "../lib/data/client.ts";
import { plural } from "../lib/format.ts";
import { setThemeEverywhere } from "../lib/theme.ts";
import type { ToastInput } from "../lib/toast.ts";

// ponytail: what the palette offers besides the registry — the screens, the dock, the theme; without a project only
// the screens that need none (Settings, the system check)
export function paletteActions(navigate: (s: Screen) => void, toggleDock: () => void, project = true): PaletteAction[] {
  return [
    ...(project ? NAV : []).map(
      (n): PaletteAction => ({
        id: `go-${n.id}`,
        label: `Go to ${n.label}`,
        icon: n.icon,
        hint: `#/${n.id}`,
        group: "Go to",
        run: () => navigate(n.id),
      }),
    ),
    {
      id: "go-settings",
      label: "Go to Settings",
      icon: "settings",
      hint: "#/settings",
      group: "Go to",
      run: () => navigate("settings"),
    },
    {
      id: "go-doctor",
      label: "Open the system check",
      icon: "doctor",
      hint: "#/doctor",
      group: "Go to",
      run: () => navigate("doctor"),
    },
    { id: "dock", label: "Show or hide Claude", icon: "claude", shortcut: "Ctrl J", hint: "dock", run: toggleDock },
    {
      id: "theme-system",
      label: "Theme: follow the system",
      icon: "monitor",
      hint: "theme",
      run: () => setThemeEverywhere("system"),
    },
    { id: "theme-light", label: "Theme: light", icon: "sun", hint: "theme", run: () => setThemeEverywhere("light") },
    { id: "theme-dark", label: "Theme: dark", icon: "moon", hint: "theme", run: () => setThemeEverywhere("dark") },
  ];
}

// ponytail: a command run from the palette says what was done in words (its summary), with the command and a short
// look at its answer under it (a job it started says so with jobToast)
const glance = (r: unknown): string => {
  if (Array.isArray(r)) return plural(r.length, "item");
  if (!r || typeof r !== "object") return r === undefined || r === null ? "" : String(r);
  return Object.entries(r)
    .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
};

export function commandToast(c: CommandInfo, result: unknown): ToastInput {
  const what = firstSentence(c.summary) || c.name;
  return { tone: "success", title: `${what} — done`, detail: [c.name, glance(result)].filter(Boolean).join(" · ") };
}
