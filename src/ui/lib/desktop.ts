import type { Job } from "../../core/types.ts";
import type { FileFilter, TestimusDesktop } from "../../desktop/bridge-types.ts";
import { call, setProject } from "../api.ts";
import type { AppState } from "./app.ts";
import { writePref } from "./theme.ts";
import { errorToast, toast } from "./toast.ts";

export const desktop = (): TestimusDesktop | null =>
  typeof window === "undefined" ? null : (window.testimusDesktop ?? null);

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

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
      toast({ kind: "error", title: "Could not show it in Explorer", detail: `${path} is not there any more.` });
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

export const ON_TOP_KEY = "testimus.alwaysOnTop";

export function readAlwaysOnTop(): boolean {
  try {
    return localStorage.getItem(ON_TOP_KEY) === "true";
  } catch {
    return false;
  }
}

export async function setAlwaysOnTop(on: boolean): Promise<boolean> {
  writePref(ON_TOP_KEY, on ? "true" : "false");
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

export async function openProject(app: Pick<AppState, "refreshInfo" | "testsChanged">, dir: string): Promise<string> {
  const r = await call<{ dir: string }>("project.open", { dir });
  setProject(r.dir);
  writePref("testimus.project", r.dir);
  app.refreshInfo();
  app.testsChanged();
  return r.dir;
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
