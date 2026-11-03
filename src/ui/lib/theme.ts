import * as stylex from "@stylexjs/stylex";
import { darkTheme, lightTheme } from "../styles/tokens.stylex.ts";

export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem("testimus.theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {}
  return "system";
}

export function themeClass(t: Theme): string {
  if (t === "system") return "";
  return stylex.props(t === "dark" ? darkTheme : lightTheme).className ?? "";
}

export function applyTheme(t: Theme): void {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.documentElement.className = themeClass(t);
  try {
    localStorage.setItem("testimus.theme", t);
  } catch {}
}

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {}
  return fallback;
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function nextTheme(t: Theme): Theme {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
}

export function setThemeEverywhere(t: Theme): void {
  applyTheme(t);
  window.dispatchEvent(new CustomEvent("testimus:theme", { detail: t }));
}

export function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function readSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}
