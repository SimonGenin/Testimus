import { useEffect, useState } from "react";
import type { SearchKind, SearchMatch, SearchResult } from "../../core/types.ts";
import { call, project } from "../api.ts";

export type SearchState = { result: SearchResult | null; loading: boolean; deep: boolean; error: string };

const WORDS_MS = 60;
const MEANING_MS = 280;

// ponytail: two passes — the words answer while typing, the meaning (embedding model, hybrid passages) comes after
// a pause and replaces them; a newer query aborts both
export function useSearch(
  query: string,
  opts: { in?: SearchKind[]; k?: number; enabled?: boolean; meaning?: boolean } = {},
): SearchState {
  const [state, setState] = useState<SearchState>({ result: null, loading: false, deep: false, error: "" });
  const scope = opts.in?.join(",") ?? "";
  const enabled = opts.enabled ?? true;
  const meaning = opts.meaning ?? true;
  const k = opts.k;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scope is opts.in as a string
  useEffect(() => {
    const q = query.trim();
    if (!enabled || !q) {
      setState({ result: null, loading: false, deep: false, error: "" });
      return;
    }
    const ctrl = new AbortController();
    const input = { query: q, ...(opts.in?.length ? { in: opts.in } : {}), ...(k ? { k } : {}) };
    setState((s) => ({ ...s, loading: true }));
    let landed = false;
    const ask = (deep: boolean) =>
      call<SearchResult>("search.all", { ...input, meaning: deep }, ctrl.signal)
        .then((result) => {
          if (ctrl.signal.aborted || !result?.hits || landed) return;
          landed = deep;
          setState({ result, loading: !deep && meaning, deep, error: "" });
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
        });
    const words = setTimeout(() => void ask(false), WORDS_MS);
    const deep = meaning ? setTimeout(() => void ask(true), MEANING_MS) : undefined;
    return () => {
      ctrl.abort();
      clearTimeout(words);
      clearTimeout(deep);
    };
  }, [query, scope, enabled, meaning, k]);
  return state;
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
const recentKey = () => `testimus.search.recent:${project() ?? ""}`;

export function recentHits(): SearchMatch[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey()) ?? "[]") as SearchMatch[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function rememberHit(h: SearchMatch): void {
  const slim: SearchMatch = { ...h, titleMarks: [], marks: [], snippet: undefined, score: 0 };
  const list = [slim, ...recentHits().filter((x) => !(x.kind === h.kind && x.id === h.id))].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(recentKey(), JSON.stringify(list));
  } catch {}
}
