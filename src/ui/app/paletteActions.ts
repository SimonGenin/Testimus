import type { PaletteAction } from "../components/shell/paletteEntries.tsx";
import { NAV } from "../components/shell/Rail.tsx";
import type { Screen } from "../lib/app.ts";
import { setThemeEverywhere } from "../lib/theme.ts";

// ponytail: what the palette offers besides the registry — the screens, the dock, the theme
export function paletteActions(navigate: (s: Screen) => void, toggleDock: () => void): PaletteAction[] {
  return [
    ...NAV.map(
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
