import { project } from "../api.ts";

// ponytail: the recent tests are a per-browser preference like the step layout — `<project dir>|<id>`,
// newest first, at most 20; the list only shows what was touched in the last 7 days
const KEY = "testimus.recent";
const MAX = 20;
export const RECENT_DAYS = 7;

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const write = (list: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
  window.dispatchEvent(new Event("testimus:recent"));
};

const tag = (id: string) => `${project() ?? ""}|${id}`;

export function addRecent(id: string): void {
  const t = tag(id);
  write([t, ...read().filter((x) => x !== t)]);
}

export function forgetRecent(id: string): void {
  const t = tag(id);
  write(read().filter((x) => x !== t));
}

export function renameRecent(from: string, to: string): void {
  const f = tag(from);
  write(read().map((x) => (x === f ? tag(to) : x)));
}

export function recentIds(): string[] {
  const p = `${project() ?? ""}|`;
  return read()
    .filter((x) => x.startsWith(p))
    .map((x) => x.slice(p.length));
}
