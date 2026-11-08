import { useMemo } from "react";
import { project } from "./data/client.ts";
import { useRead } from "./data/query.ts";

export const UNTITLED_TEST = "Untitled test";
export const UNTITLED_CONTEXT = "Untitled context";

const LOCAL = /\blocal-[0-9a-f]{6,}\b/g;

export const isLocalId = (s: string) => /^local-[0-9a-f]{6,}$/.test(s);

// ponytail: the core's rule (src/core/lib/names.ts testNameOf) for a test the page holds — its summary, else its Jira
// key; one it does not hold keeps its Jira key, a local one is « Untitled test ». Where the core names a test (a job's
// label, a check's verdict, its messages) the page shows that name. tests/unit/ui/lib/names-parity.test.ts keeps the
// two rules equal
export const testName = (t: { summary?: string; key?: string } | null | undefined, id: string): string =>
  t ? t.summary?.trim() || t.key || UNTITLED_TEST : id.startsWith("local-") ? UNTITLED_TEST : id;

// ponytail: a test whose Jira key is shown beside it is said by its summary alone; a context by its name
export const testLabel = (t: { summary?: string } | null | undefined) => t?.summary?.trim() || UNTITLED_TEST;
export const contextLabel = (c: { name?: string } | null | undefined) => c?.name?.trim() || UNTITLED_CONTEXT;

// ponytail: a test named inside a sentence — its Jira key when it has one is how the team calls it too
export const testRef = (t: { key?: string; summary?: string } | null | undefined) =>
  t?.key ? `${t.key} ${testLabel(t)}` : testLabel(t);

export type TestNames = (id: string) => string | undefined;

// ponytail: a test the page knows only by its id — its name from the project's tests (nameOf), else the rule's
export const testNamed = (nameOf: TestNames, id: string) => nameOf(id) ?? testName(null, id);

// ponytail: a text that names local tests by their id (a Claude message, a log line written before the core named
// them) reads with each test's summary in its place
export function nameTests(text: string, nameOf: TestNames): string {
  return text.replace(LOCAL, (id) => `“${nameOf(id) || testName(null, id)}”`);
}

// ponytail: the names of the project's tests (the ones being written too), for a page that only has ids
export function useTestNames(): TestNames {
  const list = useRead("tests.list", { generating: true }, { enabled: !!project() });
  return useMemo(() => {
    const by = new Map((list.data ?? []).map((t) => [t.id, testName(t, t.id)]));
    return (id: string) => by.get(id);
  }, [list.data]);
}
