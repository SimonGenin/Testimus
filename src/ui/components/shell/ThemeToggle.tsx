import { useEffect, useState } from "react";
import { nextTheme, readTheme, setThemeEverywhere, type Theme } from "../../lib/theme.ts";
import { Icon, type IconName } from "../ui/index.ts";

const LOOK: Record<Theme, { label: string; icon: IconName }> = {
  system: { label: "System", icon: "system" },
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("testimus:theme", onTheme);
    return () => window.removeEventListener("testimus:theme", onTheme);
  }, []);
  const l = LOOK[theme];
  const next = LOOK[nextTheme(theme)].label;
  return (
    <button
      type="button"
      className="rail-item rail-theme"
      aria-label={`Theme: ${l.label}. Switch to ${next}`}
      title={`Theme: ${l.label} — click for ${next}`}
      onClick={() => setThemeEverywhere(nextTheme(theme))}
    >
      <Icon name={l.icon} size={18} />
      <span>{l.label}</span>
    </button>
  );
}
