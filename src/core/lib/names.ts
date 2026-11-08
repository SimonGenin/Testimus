import { join } from "node:path";
import type { ClaudeScope } from "../types.ts";
import { findDoc } from "./docs.ts";
import { readJson } from "./project.ts";
import { localTestRef } from "./store.ts";

export const UNTITLED_TEST = "Untitled test";
export const UNTITLED_DOC = "Untitled document";

// ponytail: a local test's id (local-4df6ff7b) means nothing to a person — what the core says about a test names it
// by its summary, else its Jira key; a test that is gone keeps its Jira key, a local one becomes « Untitled test ».
// The page has the same rule for the tests it holds (src/ui/lib/labels.ts testName); a test keeps the two equal
export const testNameOf = (t: { summary?: string; key?: string } | null, id: string): string =>
  t ? t.summary?.trim() || t.key || UNTITLED_TEST : id.startsWith("local-") ? UNTITLED_TEST : id;

export const testName = (project: string | null, id: string): string =>
  testNameOf(project ? localTestRef(project, id) : null, id);

export function docName(project: string | null, id: string): string {
  const doc = project ? findDoc(project, id) : null;
  return doc ? doc.title.trim() || UNTITLED_DOC : id;
}

export const quoted = (name: string) => `« ${name} »`;

export const testsName = (project: string | null, ids: readonly string[]): string =>
  ids.length === 1 ? testName(project, ids[0]) : `${ids.length} tests`;

export function scopeName(project: string | null, s: ClaudeScope): string {
  if (s.kind === "doc") return docName(project, s.docId);
  if (s.kind === "step") return `${testName(project, s.testId)} · step ${s.step}`;
  if (s.kind === "test") return testName(project, s.testId);
  if (s.kind === "tests") return `${s.testIds.length} tests`;
  return "the project";
}

export const UNTITLED_GENERATION = "A generation";

// ponytail: a generation is known by what it was asked — its request in words, else the documents it read whole, else
// its sections; never its job id
export function generationName(project: string | null, id: string): string {
  type Asked = { input?: { request?: string; docs?: string[]; sections?: string[] } };
  const input = project ? readJson<Asked | null>(join(project, ".testimus", "gen", `${id}.json`), null)?.input : null;
  const request = input?.request?.replace(/\s+/g, " ").trim() ?? "";
  if (request) return request.length > 60 ? `${request.slice(0, 59)}…` : request;
  const docs = (input?.docs ?? []).map((d) => docName(project, d));
  if (docs.length) return docs.join(", ");
  const sections = input?.sections ?? [];
  if (sections.length) return sections.length === 1 ? sections[0] : `${sections.length} sections`;
  return UNTITLED_GENERATION;
}
