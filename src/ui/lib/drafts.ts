import { project } from "../api.ts";

// ponytail: what was open on each screen outlives it (the rail reopens it) — kept in memory for the page's life, per
// project, never written to storage
const drafts = new Map<string, unknown>();
const slot = (key: string) => `${project() ?? ""}\n${key}`;

export function clearDrafts(): void {
  drafts.clear();
}

export function keepDraft(key: string, value: unknown): void {
  drafts.set(slot(key), value);
}

export function draftOf<T>(key: string): T | undefined {
  return drafts.get(slot(key)) as T | undefined;
}
