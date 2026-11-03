import * as stylex from "@stylexjs/stylex";
import { color, darkTheme, fontFamily, fontSize, lightTheme, lineHeight } from "../styles/tokens.stylex.ts";
import {
  onPrefsChange,
  PREFS,
  type PrefName,
  readPref as readNamed,
  usePref,
  writePref as writeNamed,
} from "./prefs.ts";

export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];

export const readTheme = (): Theme => readNamed("theme") as Theme;

const page = stylex.create({
  root: {
    backgroundColor: color.canvas,
    color: color.text,
    colorScheme: color.scheme,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
  },
});

// ponytail: <html> carries the page's base (canvas, text, font, color-scheme) and, for an explicit choice, the theme
export function themeClass(t: Theme): string {
  const theme = t === "system" ? [] : t === "dark" ? darkTheme : lightTheme;
  return stylex.props(page.root, ...theme).className ?? "";
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

// ponytail: <html> follows the theme preference wherever it is written — this page, another window of the profile,
// or a script that writes the storage and says so with a storage event
export function followTheme(): () => void {
  const sync = () => show(readTheme());
  sync();
  const off = onPrefsChange(sync);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === "testimus.theme") sync();
  };
  window.addEventListener("storage", onStorage);
  return () => {
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

const named = (key: string): PrefName | null => {
  const name = key.replace(/^testimus\./, "");
  return name in PREFS ? (name as PrefName) : null;
};

const shown = (name: PrefName): string => (PREFS[name].show as (v: unknown) => string)(readNamed(name));

function writeShown(name: PrefName, raw: string): void {
  const p = PREFS[name] as { parse(raw: string): unknown; fallback: unknown };
  writeNamed(name, (p.parse(raw) ?? p.fallback) as never);
}

// ponytail: the string-keyed reads and writes of the screens not yet on usePref; only declared preferences are kept
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const name = named(key);
  const v = name ? shown(name) : "";
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function writePref(key: string, value: string): void {
  const name = named(key);
  if (name) writeShown(name, value);
}

export function readString(key: string): string {
  const name = named(key);
  return name ? shown(name) : "";
}

export const readSession = readString;

export const writeSession = writePref;
