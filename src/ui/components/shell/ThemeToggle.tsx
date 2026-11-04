import { nextTheme, type Theme, useTheme } from "../../lib/theme.ts";
import type { IconName } from "../ui/Icon.tsx";
import { RailItem } from "../ui/RailItem.tsx";

const LOOK: Record<Theme, { label: string; icon: IconName }> = {
  system: { label: "System", icon: "monitor" },
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
};

// ponytail: the theme from the rail, one click to the next (system → light → dark)
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const l = LOOK[theme];
  const next = LOOK[nextTheme(theme)].label;
  return (
    <RailItem
      label={l.label}
      icon={l.icon}
      ariaLabel={`Theme: ${l.label}. Switch to ${next}`}
      onClick={() => setTheme(nextTheme(theme))}
    />
  );
}
