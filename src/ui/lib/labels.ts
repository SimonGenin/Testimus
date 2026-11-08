import { useMemo } from "react";
import { project } from "./data/client.ts";
import { useRead } from "./data/query.ts";

export const UNTITLED_TEST = "Untitled test";
export const UNTITLED_DOC = "Untitled document";
export const UNTITLED_CONTEXT = "Untitled context";

const LOCAL = /\blocal-[0-9a-f]{6,}\b/g;

export const isLocalId = (s: string) => /^local-[0-9a-f]{6,}$/.test(s);

// ponytail: what a person calls a test, a document, a context — its summary, title or name; a missing one is
// « Untitled … », never the id (local-4df6ff7b, ctx-1a2b3c4d mean nothing to them)
export const testLabel = (t: { summary?: string } | null | undefined) => t?.summary?.trim() || UNTITLED_TEST;
export const docLabel = (d: { title?: string } | null | undefined) => d?.title?.trim() || UNTITLED_DOC;
export const contextLabel = (c: { name?: string } | null | undefined) => c?.name?.trim() || UNTITLED_CONTEXT;

// ponytail: a test named inside a sentence — its Jira key when it has one is how the team calls it too
export const testRef = (t: { key?: string; summary?: string } | null | undefined) =>
  t?.key ? `${t.key} ${testLabel(t)}` : testLabel(t);

export type TestNames = (id: string) => string | undefined;

// ponytail: a text that names local tests by their id (a Claude message, a log line written before the core named
// them) reads with each test's summary in its place
export function nameTests(text: string, nameOf: TestNames): string {
  return text.replace(LOCAL, (id) => `“${nameOf(id) || UNTITLED_TEST}”`);
}

// ponytail: the summaries of the project's tests (the ones being written too), for a page that only has ids
export function useTestNames(): TestNames {
  const list = useRead("tests.list", { generating: true }, { enabled: !!project() });
  return useMemo(() => {
    const by = new Map((list.data ?? []).map((t) => [t.id, t.summary.trim() || t.key || UNTITLED_TEST]));
    return (id: string) => by.get(id);
  }, [list.data]);
}
