import type { Job } from "../../core/types.ts";
import type { FileFilter, TestimusDesktop } from "../../desktop/bridge-types.ts";
import { setProject } from "../api.ts";
import type { AppState } from "./app.ts";
import { readPref, writePref } from "./prefs.ts";
import { errorToast, toast } from "./toast.ts";

export const desktop = (): TestimusDesktop | null =>
  typeof window === "undefined" ? null : (window.testimusDesktop ?? null);

export const baseName = (path: string | undefined) => (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? path ?? "";

export const onWindows = () => typeof navigator === "undefined" || /Windows|win32/i.test(navigator.userAgent);

export const examplePath = (windows: string, other: string) => (onWindows() ? windows : other);

export const absolutePath = (path: string) => /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(path);

export function pathJoin(dir: string, ...parts: string[]): string {
  const sep = dir.includes("/") && !dir.includes("\\") ? "/" : "\\";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

export const windowTitle = (name?: string) => (name ? `Testimus — ${name}` : "Testimus");

export async function pickFolder(title: string): Promise<string | null> {
  const d = desktop();
  if (!d) return null;
  try {
    return await d.pickFolder({ title });
  } catch (e) {
    errorToast(e, "Could not open the folder dialog");
    return null;
  }
}

export async function pickFiles(title: string, filters: FileFilter[], multiple: boolean): Promise<string[]> {
  const d = desktop();
  if (!d) return [];
  try {
    return await d.pickFiles({ title, filters, multiple });
  } catch (e) {
    errorToast(e, "Could not open the file dialog");
    return [];
  }
}

export const pathOf = (file: File): string => desktop()?.pathOf(file) ?? "";

export async function reveal(path: string): Promise<void> {
  const d = desktop();
  if (!d) return;
  try {
    if (!(await d.reveal(path)))
      toast({ tone: "danger", title: "Could not show it in Explorer", detail: `${path} is not there any more.` });
  } catch (e) {
    errorToast(e, "Could not show it in Explorer");
  }
}

export function openExternal(url: string): boolean {
  const d = desktop();
  if (!d) return false;
  d.openExternal(url).catch((e) => errorToast(e, "Could not open the link"));
  return true;
}

export const readAlwaysOnTop = (): boolean => readPref("alwaysOnTop");

export async function setAlwaysOnTop(on: boolean): Promise<boolean> {
  writePref("alwaysOnTop", on);
  window.dispatchEvent(new CustomEvent("testimus:on-top", { detail: on }));
  const d = desktop();
  if (!d?.setAlwaysOnTop) return false;
  try {
    return await d.setAlwaysOnTop(on);
  } catch (e) {
    errorToast(e, "Could not change always on top");
    return false;
  }
}

// ponytail: the window forgets it between runs — the page that remembers it puts it back at start
export function restoreAlwaysOnTop(): void {
  if (desktop() && readAlwaysOnTop()) void setAlwaysOnTop(true);
}

// ponytail: project.init and project.openKey already made the project the current one — the page only follows
export function showProject(app: Pick<AppState, "refreshInfo" | "testsChanged">, dir: string): string {
  setProject(dir);
  writePref("project", dir);
  app.refreshInfo();
  app.testsChanged();
  return dir;
}

export const PROGRESS_KINDS = new Set(["generate", "rag-index", "check", "pull", "pullModel", "models-pull"]);

export type Tracked = { done: number; total: number };

export const tracked = (job: Pick<Job, "progress">): Tracked => ({
  done: job.progress?.done ?? 0,
  total: job.progress?.total ?? 0,
});

export function taskbarFraction(jobs: Tracked[]): number | null {
  if (!jobs.length) return null;
  const sum = jobs.reduce((s, j) => s + (j.total > 0 ? Math.min(1, Math.max(0, j.done / j.total)) : 0), 0);
  return Math.round((sum / jobs.length) * 100) / 100;
}
