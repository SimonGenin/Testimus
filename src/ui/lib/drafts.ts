import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import { project } from "../api.ts";

// ponytail: what was typed or chosen and not saved yet outlives its screen — kept in memory for the page's life,
// per project, never written to storage (a token half-typed in a form stays in this tab). A field reads its draft
// back only once it was set: until then it starts from its initial value as before. `base` shows a value read from
// the project (what is saved) without making it a draft, so a later read is not hidden by an old copy
const drafts = new Map<string, unknown>();
const slot = (key: string) => `${project() ?? ""}\n${key}`;

function read<T>(k: string, initial: T | (() => T)): T {
  if (drafts.has(k)) return drafts.get(k) as T;
  return typeof initial === "function" ? (initial as () => T)() : initial;
}

export function useDraft<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>, (saved: T) => void] {
  const k = slot(key);
  const [cell, setCell] = useState(() => ({ k, v: read(k, initial) }));
  let shown = cell;
  if (cell.k !== k) {
    shown = { k, v: read(k, initial) };
    setCell(shown);
  }
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setCell((c) => {
        const v = typeof next === "function" ? (next as (prev: T) => T)(c.v) : next;
        drafts.set(c.k, v);
        return { k: c.k, v };
      }),
    [],
  );
  const base = useCallback(
    (saved: T) =>
      setCell((c) => {
        if (drafts.has(c.k)) return c;
        return { k: c.k, v: saved };
      }),
    [],
  );
  return [shown.v, set, base];
}

export function dropDraft(...keys: string[]): void {
  for (const key of keys) drafts.delete(slot(key));
}

export function clearDrafts(): void {
  drafts.clear();
}

export function keepDraft(key: string, value: unknown): void {
  drafts.set(slot(key), value);
}

export function draftOf<T>(key: string): T | undefined {
  return drafts.get(slot(key)) as T | undefined;
}
