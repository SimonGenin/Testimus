import * as stylex from "@stylexjs/stylex";
import { type } from "../components/ui/type.ts";
import { color, darkTheme, fontFamily, lightTheme } from "../styles/tokens.stylex.ts";
import { onPrefsChange, readPref as readNamed, usePref, writePref as writeNamed } from "./prefs.ts";

export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];

export const readTheme = (): Theme => readNamed("theme") as Theme;

const page = stylex.create({
  root: {
    height: "100%",
    backgroundColor: color.canvas,
    color: color.text,
    colorScheme: color.scheme,
    fontFamily: fontFamily.ui,
  },
});

// ponytail: <html> carries the page's base (canvas, text, font, color-scheme) and, for an explicit choice, the theme
export function themeClass(t: Theme): string {
  const theme = t === "system" ? [] : t === "dark" ? darkTheme : lightTheme;
  return stylex.props(type.body, page.root, ...theme).className ?? "";
}

function show(t: Theme): void {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.documentElement.className = themeClass(t);
}

export function applyTheme(t: Theme): void {
  show(t);
  writeNamed("theme", t);
}

// ponytail: <html> follows the theme wherever it is set — its data-theme (this page, public/theme.js before React, a
// script or a test) gives the class of the page's base and theme; the preference written here or in another window
// of the profile gives the data-theme
export function followTheme(): () => void {
  const root = document.documentElement;
  const classFor = () => {
    const t = root.dataset.theme;
    root.className = themeClass(t === "light" || t === "dark" ? t : "system");
  };
  const sync = () => show(readTheme());
  const watch = new MutationObserver(classFor);
  watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  classFor();
  const off = onPrefsChange(sync);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === "testimus.theme") sync();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    watch.disconnect();
    off();
    window.removeEventListener("storage", onStorage);
  };
}

export function nextTheme(t: Theme): Theme {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
}

// ponytail: the testimus:theme event is for the screens that still listen to it (Settings › Appearance); the shell
// follows the preference itself (useTheme)
export function setThemeEverywhere(t: Theme): void {
  applyTheme(t);
  window.dispatchEvent(new CustomEvent("testimus:theme", { detail: t }));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme] = usePref("theme");
  return [theme as Theme, setThemeEverywhere];
}
