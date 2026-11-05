import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { ApiError } from "./client.ts";
import { type Key, matches, type Prefix, setFlushHook } from "./query.ts";

export type AutosaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

// returns the version the file has after the save (its mtime), when the command says it
export type Save<T> = (value: T, base: string | undefined) => Promise<string | undefined | void>;

type Entry = {
  key: Key;
  value: unknown;
  dirty: boolean;
  edit: number;
  base?: string;
  saved?: string;
  status: AutosaveStatus;
  error?: string;
  timer?: ReturnType<typeof setTimeout>;
  flight: Promise<void> | null;
  save: Save<unknown>;
  delay: number | "blur";
  listeners: Set<() => void>;
};

const entries = new Map<string, Entry>();
const idOf = (k: Key) => JSON.stringify(k);

function notify(e: Entry): void {
  for (const fn of e.listeners) fn();
}

function entryFor(key: Key, save: Save<unknown>, delay: number | "blur"): Entry {
  const id = idOf(key);
  let e = entries.get(id);
  if (!e) {
    e = {
      key,
      value: undefined,
      dirty: false,
      edit: 0,
      status: "saved",
      flight: null,
      save,
      delay,
      listeners: new Set(),
    };
    entries.set(id, e);
  }
  return e;
}

function schedule(e: Entry): void {
  clearTimeout(e.timer);
  if (e.delay !== "blur" && e.status !== "conflict") e.timer = setTimeout(() => void send(e), e.delay);
}

// ponytail: one save in the air per key; edits made meanwhile wait for it and leave with the version it returned
async function send(e: Entry, force = false): Promise<void> {
  clearTimeout(e.timer);
  if (e.flight) {
    await e.flight;
    if (e.dirty) return send(e, force);
    return;
  }
  if (!e.dirty || (e.status === "conflict" && !force)) return;
  const edit = e.edit;
  const value = e.value;
  e.status = "saving";
  e.error = undefined;
  notify(e);
  e.flight = (async () => {
    try {
      const after = await e.save(value, force ? undefined : e.base);
      if (typeof after === "string") e.base = e.saved = after;
      if (e.edit === edit) {
        e.dirty = false;
        e.value = undefined;
        e.status = "saved";
      } else e.status = e.dirty ? "pending" : "saved";
    } catch (err) {
      const conflict = err instanceof ApiError && err.code === "conflict";
      e.status = !e.dirty ? "saved" : conflict ? "conflict" : "error";
      e.error = e.dirty ? (err instanceof Error ? err.message : String(err)) : undefined;
    } finally {
      e.flight = null;
      notify(e);
    }
  })();
  await e.flight;
  if (e.dirty && (e.status as AutosaveStatus) === "pending") schedule(e);
}

// ponytail: what still stands between the edit on screen and the file — a change on disk under it, or a refused save
function unsaved(e: Entry): ApiError | null {
  if (!e.dirty || (e.status !== "conflict" && e.status !== "error")) return null;
  const id = (e.key[2] as { id?: unknown } | undefined)?.id;
  const what = typeof id === "string" ? `Your change to ${id}` : "Your last change";
  if (e.status === "conflict")
    return new ApiError(
      `${what} is not saved: the file changed on disk while you were editing it.`,
      "Choose « Keep mine » or « Reload from disk » first.",
      409,
      "conflict",
    );
  const why = (e.error || "the save failed").replace(/\.$/, "");
  return new ApiError(`${what} is not saved: ${why}.`, "Retry the save first.", 0, "unsaved");
}

// ponytail: sends what waits until nothing does, and says why when the edit could not be written
async function flushEntry(e: Entry): Promise<ApiError | null> {
  await send(e);
  while (e.dirty && e.status === "pending") await send(e);
  return unsaved(e);
}

export async function flushAutosaves(prefixes?: Prefix[], p?: string | null): Promise<ApiError | null> {
  const list = [...entries.values()].filter(
    (e) => !prefixes || prefixes.some((x) => matches(e.key, x, p === undefined ? e.key[0] : p)),
  );
  const why = await Promise.all(list.map(flushEntry));
  return why.find((w) => w !== null) ?? null;
}

export function discardAutosave(key: Key): void {
  const e = entries.get(idOf(key));
  if (!e) return;
  clearTimeout(e.timer);
  e.dirty = false;
  e.value = undefined;
  e.status = "saved";
  notify(e);
}

export function pendingAutosaves(): Key[] {
  return [...entries.values()].filter((e) => e.dirty).map((e) => e.key);
}

let wired = false;

// ponytail: leaving the window, hiding the tab or closing the page sends what is waiting
function wireWindow(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  setFlushHook((prefixes, p) => flushAutosaves(prefixes, p ?? undefined));
  const all = () => void flushAutosaves();
  window.addEventListener("blur", all);
  window.addEventListener("pagehide", all);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") all();
  });
}

export type Autosave<T> = {
  value: T | undefined;
  set(next: T | ((prev: T | undefined) => T)): void;
  status: AutosaveStatus;
  error?: string;
  flush(): Promise<void>;
  // sends what waits now and resolves to why the edit on screen is not written (a conflict, a refused save), null
  // once it is — a gesture that reads the file asks this first
  saveNow(): Promise<ApiError | null>;
  retry(): Promise<void>;
  keepMine(): Promise<void>;
  takeDisk(): void;
  readOnly: boolean;
};

export type AutosaveOptions<T> = {
  key: Key;
  // what the server holds now, and its version (the file's mtime) when the read says it
  value: T | undefined;
  base?: string;
  save: Save<T>;
  delay?: number | "blur";
  readOnly?: boolean;
};

export function useAutosave<T>(o: AutosaveOptions<T>): Autosave<T> {
  const client: QueryClient = useQueryClient();
  const delay = o.delay ?? 400;
  const e = entryFor(o.key, o.save as Save<unknown>, delay);
  e.save = o.save as Save<unknown>;
  e.delay = delay;
  wireWindow();
  const version = useSyncExternalStore(
    (fn) => {
      e.listeners.add(fn);
      return () => e.listeners.delete(fn);
    },
    () => `${e.status}|${e.edit}|${e.dirty}`,
  );
  void version;
  const ro = useRef(o.readOnly ?? false);
  ro.current = o.readOnly ?? false;
  const read = useRef(o.base);
  read.current = o.base;

  useEffect(() => {
    if (o.base === undefined) return;
    if (!e.dirty) e.base = o.base;
    else if (o.base !== e.base && o.base !== e.saved && e.status !== "conflict" && !e.flight) {
      clearTimeout(e.timer);
      e.status = "conflict";
      e.error = "The file changed on disk while you were editing it.";
      notify(e);
    }
  }, [o.base, e]);

  useEffect(
    () => () => {
      void send(e);
    },
    [e],
  );

  const set = useCallback(
    (next: T | ((prev: T | undefined) => T)) => {
      if (ro.current) return;
      const prev = (e.dirty ? e.value : o.value) as T | undefined;
      e.value = typeof next === "function" ? (next as (p: T | undefined) => T)(prev) : next;
      e.dirty = true;
      e.edit++;
      if (e.status !== "conflict" && e.status !== "saving") e.status = "pending";
      schedule(e);
      notify(e);
    },
    [e, o.value],
  );

  return {
    value: (e.dirty ? e.value : o.value) as T | undefined,
    set,
    status: e.status,
    error: e.error,
    flush: async () => {
      await flushEntry(e);
    },
    saveNow: () => flushEntry(e),
    retry: () => send(e),
    keepMine: () => send(e, true),
    // ponytail: the edit goes and the version read last becomes the base — a read that comes back the same would not
    // move it, and the next edit would be refused as a conflict nobody made
    takeDisk: () => {
      discardAutosave(o.key);
      if (read.current !== undefined) e.base = read.current;
      void client.invalidateQueries({ queryKey: o.key as unknown as readonly unknown[] });
    },
    readOnly: o.readOnly ?? false,
  };
}

const drafts = new Map<string, string>();
const draftListeners = new Set<() => void>();

// ponytail: unsent typing (the dock's prompt, a To fix note, a form being filled) kept per key for the life of the page;
// returning to the screen finds it, sending clears it
export function useDraft(key: Key | null, initial = ""): [string, (next: string) => void, () => void] {
  const id = key ? idOf(key) : null;
  useSyncExternalStore(
    (fn) => {
      draftListeners.add(fn);
      return () => draftListeners.delete(fn);
    },
    () => (id ? drafts.get(id) : undefined),
  );
  const set = useCallback(
    (next: string) => {
      if (!id) return;
      drafts.set(id, next);
      for (const fn of draftListeners) fn();
    },
    [id],
  );
  const clear = useCallback(() => {
    if (!id) return;
    drafts.delete(id);
    for (const fn of draftListeners) fn();
  }, [id]);
  return [id ? (drafts.get(id) ?? initial) : initial, set, clear];
}

// ponytail: for the tests — forgets every unsent draft and every edit waiting for its save, as a fresh page would
export function clearDrafts(): void {
  for (const e of entries.values()) {
    clearTimeout(e.timer);
    e.dirty = false;
    e.value = undefined;
    e.status = "saved";
    notify(e);
  }
  entries.clear();
  drafts.clear();
  for (const fn of draftListeners) fn();
}
