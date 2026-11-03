import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "../env.ts";
import type { ProjectJson, Settings, XrayJson } from "../types.ts";
import { writeAtomic } from "./atomic.ts";

export const DEFAULT_PROJECT: ProjectJson = {
  name: "",
  jiraProject: "",
  language: "fr",
  labelPrefix: "testimus-",
  folders: [],
  rag: { embedding: "bge-m3", reranker: null },
  claude: { model: "opus", effort: "high", presets: [], contexts: [] },
};

export const DEFAULT_XRAY: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: [], hidden: [], filled: ["Data"] },
};

export const DEFAULT_SETTINGS: Settings = {
  projects: [],
  lastProject: "",
  theme: "system",
  stepLayout: "stacked",
  claude: { exe: "" },
  models: { allowRemote: true },
};

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as T;
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJson(file: string, value: unknown): void {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readProject(dir: string): ProjectJson {
  const p = readJson<Partial<ProjectJson>>(join(dir, "project.json"), {});
  return {
    ...DEFAULT_PROJECT,
    ...p,
    rag: { ...DEFAULT_PROJECT.rag, ...p.rag },
    claude: { ...DEFAULT_PROJECT.claude, ...p.claude },
  };
}

export function writeProject(dir: string, p: ProjectJson): void {
  writeJson(join(dir, "project.json"), p);
}

export function readXray(dir: string): XrayJson {
  const x = readJson<Partial<XrayJson>>(join(dir, "xray.json"), {});
  return {
    fields: x.fields?.length ? x.fields : DEFAULT_XRAY.fields,
    prefs: { ...DEFAULT_XRAY.prefs, ...x.prefs },
    fetchedAt: x.fetchedAt,
    ...(x.columns?.length ? { columns: x.columns } : {}),
  };
}

export function localColumns(x: XrayJson): string[] {
  const ids = new Set(x.fields.map((f) => f.id));
  const names = new Set(x.fields.map((f) => f.name.toLowerCase()));
  return (x.columns ?? [])
    .filter((c) => !(c.id && ids.has(c.id)) && !names.has(c.name.toLowerCase()))
    .map((c) => c.name);
}

export function writeXray(dir: string, x: XrayJson): void {
  writeJson(join(dir, "xray.json"), x);
}

export function isProject(dir: string): boolean {
  return existsSync(join(dir, "project.json"));
}

export function settingsFile(): string {
  return join(env.dataDir(), "settings.json");
}

export function readSettings(): Settings {
  const s = readJson<Partial<Settings>>(settingsFile(), {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    claude: { ...DEFAULT_SETTINGS.claude, ...s.claude },
    models: { ...DEFAULT_SETTINGS.models, ...s.models },
  };
}

export function writeSettings(s: Settings): void {
  writeJson(settingsFile(), s);
}

export function rememberProject(dir: string): void {
  const s = readSettings();
  const abs = resolve(dir);
  s.projects = [abs, ...s.projects.filter((p) => p !== abs)].slice(0, 20);
  s.lastProject = abs;
  writeSettings(s);
}

export function resolveProjectDir(explicit?: string): string | null {
  if (explicit) return resolve(explicit);
  if (process.env.TESTIMUS_PROJECT) return resolve(process.env.TESTIMUS_PROJECT);
  if (isProject(process.cwd())) return process.cwd();
  const last = readSettings().lastProject;
  return last && isProject(last) ? last : null;
}

export function fieldOrder(x: XrayJson): string[] {
  const names = [...x.fields.map((f) => f.name), ...localColumns(x)];
  const ordered = x.prefs.order.filter((n) => names.includes(n));
  return [...ordered, ...names.filter((n) => !ordered.includes(n))];
}
