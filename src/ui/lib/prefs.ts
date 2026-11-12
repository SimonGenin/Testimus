import { useCallback, useSyncExternalStore } from "react";

// ponytail: presentation only (widths, folds, theme, layout) — a preference that changes what the app does is a
// command. Kept per browser profile under `testimus.<name>`; a session preference lives as long
// as the tab. Values are stored as the strings the shell's theme.js and the desktop mirror already read.
type Pref<T> = { fallback: T; parse(raw: string): T | undefined; show(value: T): string; session?: true };

function oneOf<T extends string>(values: readonly T[], fallback: T): Pref<T> {
  return { fallback, parse: (r) => (values.includes(r as T) ? (r as T) : undefined), show: (v) => v };
}

function flag(fallback: boolean, session?: true): Pref<boolean> {
  return {
    fallback,
    parse: (r) => (r === "1" || r === "true" ? true : r === "0" || r === "false" ? false : undefined),
    show: (v) => (v ? "1" : "0"),
    ...(session ? { session } : {}),
  };
}

function width(min: number, max: number): Pref<number | null> {
  return {
    fallback: null,
    parse: (r) => {
      const n = Number(r);
      return r !== "" && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
    },
    show: (v) => (v === null ? "" : String(v)),
  };
}

// a pane's share of the frame it splits with another, in percent
function share(): Pref<number | null> {
  return width(20, 80);
}

function text(fallback: string): Pref<string> {
  return { fallback, parse: (r) => r, show: (v) => v };
}

// ponytail: a screen's sections and tabs (lib/workspace/layout.ts checks the shape: anything it cannot read is the
// screen's own layout)
function layout(): Pref<unknown> {
  return {
    fallback: null,
    parse: (r) => {
      try {
        return JSON.parse(r) as unknown;
      } catch {
        return undefined;
      }
    },
    show: (v) => (v === null ? "" : JSON.stringify(v)),
  };
}

export const PREFS = {
  theme: oneOf(["system", "light", "dark"], "system"),
  stepLayout: oneOf(["stacked", "split"], "stacked"),
  jiraLayout: oneOf(["columns", "rows"], "columns"),
  localLayout: oneOf(["tree", "columns", "rows"], "tree"),
  showDetails: flag(true),
  runFoldOk: flag(false),
  alwaysOnTop: flag(false),
  project: text(""),
  setupShown: flag(false, true),
  jiraColumnsShare: share(),
  jiraRowsShare: share(),
  localColumnsShare: share(),
  localRowsShare: share(),
  generateColumnsShare: share(),
  generateRowsShare: share(),
  editorWidth: width(560, 4000),
  docsTocWidth: width(180, 420),
  layoutReview: layout(),
  layoutTests: layout(),
  layoutRun: layout(),
  layoutRunTest: layout(),
  layoutDocuments: layout(),
  layoutGenerate: layout(),
  layoutSettings: layout(),
  layoutDoctor: layout(),
  layoutKit: layout(),
} satisfies Record<string, Pref<unknown>>;

export type PrefName = keyof typeof PREFS;
export type PrefValue<N extends PrefName> = (typeof PREFS)[N]["fallback"];

const storageKey = (name: string) => `testimus.${name}`;
const listeners = new Set<() => void>();
let generation = 0;

function store(session?: true): Storage | null {
  try {
    return session ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function changed(): void {
  generation++;
  for (const fn of listeners) fn();
}

export function readPref<N extends PrefName>(name: N): PrefValue<N> {
  const p = PREFS[name] as Pref<PrefValue<N>>;
  try {
    const raw = store(p.session)?.getItem(storageKey(name));
    if (raw !== null && raw !== undefined) return p.parse(raw) ?? p.fallback;
  } catch {}
  return p.fallback;
}

export function writePref<N extends PrefName>(name: N, value: PrefValue<N>): void {
  const p = PREFS[name] as Pref<PrefValue<N>>;
  try {
    const s = store(p.session);
    const shown = p.show(value);
    if (shown === "" || value === p.fallback) s?.removeItem(storageKey(name));
    else s?.setItem(storageKey(name), shown);
  } catch {}
  changed();
}

// ponytail: outside React (the desktop mirror pushes a change at once, not on its next tick)
export function onPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePref<N extends PrefName>(name: N): [PrefValue<N>, (value: PrefValue<N>) => void] {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(name)) changed();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(fn);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => generation,
  );
  const set = useCallback((v: PrefValue<N>) => writePref(name, v), [name]);
  return [readPref(name), set];
}

// ponytail: the desktop window mirrors every kept preference into settings.json and back (a browser profile per app)
export function savedPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  const s = store();
  for (const name of Object.keys(PREFS) as PrefName[]) {
    if ((PREFS[name] as Pref<unknown>).session) continue;
    const raw = s?.getItem(storageKey(name));
    if (raw !== null && raw !== undefined) out[storageKey(name)] = raw;
  }
  return out;
}

export function restorePrefs(saved: Record<string, string>): void {
  const s = store();
  for (const name of Object.keys(PREFS) as PrefName[]) {
    const raw = saved[storageKey(name)];
    if (typeof raw === "string" && (PREFS[name] as Pref<unknown>).parse(raw) !== undefined)
      try {
        s?.setItem(storageKey(name), raw);
      } catch {}
  }
  changed();
}

// ponytail: the palette's recently opened hits, one list per project (the caller checks each item's shape)
export function readRecent(project: string): unknown[] {
  try {
    const v = JSON.parse(store()?.getItem(`testimus.search.recent:${project}`) ?? "[]") as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function writeRecent(project: string, list: unknown[]): void {
  try {
    store()?.setItem(`testimus.search.recent:${project}`, JSON.stringify(list));
  } catch {}
  changed();
}
