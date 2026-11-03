import { useEffect, useState } from "react";
import type { SearchKind, SearchMatch, SearchResult } from "../../core/types.ts";
import { project } from "./data/client.ts";
import { useRead } from "./data/query.ts";
import { readRecent, writeRecent } from "./prefs.ts";

export type SearchState = { result: SearchResult | null; loading: boolean; deep: boolean; error: string };

const WORDS_MS = 60;
const MEANING_MS = 280;

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

// ponytail: two reads of search.all — the words answer while typing, the meaning (embedding model, hybrid passages)
// comes after a pause and replaces them; an answer to an older query is never shown
export function useSearch(
  query: string,
  opts: { in?: SearchKind[]; k?: number; enabled?: boolean; meaning?: boolean } = {},
): SearchState {
  const q = query.trim();
  const on = (opts.enabled ?? true) && !!q;
  const meaning = opts.meaning ?? true;
  const input = { query: q, ...(opts.in?.length ? { in: opts.in } : {}), ...(opts.k ? { k: opts.k } : {}) };
  const key = JSON.stringify(input);
  const wordsKey = useSettled(key, WORDS_MS);
  const deepKey = useSettled(key, MEANING_MS);
  const words = useRead(
    "search.all",
    { ...JSON.parse(wordsKey), meaning: false },
    { enabled: on && wordsKey === key },
  );
  const deep = useRead(
    "search.all",
    { ...JSON.parse(deepKey), meaning: true },
    { enabled: on && meaning && deepKey === key },
  );
  if (!on) return { result: null, loading: false, deep: false, error: "" };
  const deepHere = meaning && deepKey === key && !!deep.data?.hits;
  const wordsHere = wordsKey === key && !!words.data?.hits;
  const result = (deepHere ? deep.data : wordsHere ? words.data : null) as SearchResult | null;
  const error = (deepHere ? null : (words.error ?? deep.error))?.message ?? "";
  const loading = !error && (!result || (meaning && !deepHere));
  return { result, loading, deep: deepHere, error };
}

// ponytail: the step a search result points at, picked up by the editor once the test is on screen
let jump: { testId: string; step: number } | null = null;

export function jumpTo(testId: string, step?: number): void {
  jump = step ? { testId, step } : null;
}

export function takeJump(testId: string): number | null {
  if (!jump || jump.testId !== testId) return null;
  const step = jump.step;
  jump = null;
  return step;
}

const RECENT_MAX = 6;

export function recentHits(): SearchMatch[] {
  return readRecent(project() ?? "").filter(
    (h): h is SearchMatch => !!h && typeof h === "object" && "kind" in h && "id" in h,
  );
}

export function rememberHit(h: SearchMatch): void {
  const slim: SearchMatch = { ...h, titleMarks: [], marks: [], snippet: undefined, score: 0 };
  writeRecent(
    project() ?? "",
    [slim, ...recentHits().filter((x) => !(x.kind === h.kind && x.id === h.id))].slice(0, RECENT_MAX),
  );
}
