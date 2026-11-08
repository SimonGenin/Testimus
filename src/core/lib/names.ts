import type { ClaudeScope } from "../types.ts";
import { findDoc } from "./docs.ts";
import { localTestRef } from "./store.ts";

export const UNTITLED_TEST = "Untitled test";
export const UNTITLED_DOC = "Untitled document";

// ponytail: a local test's id (local-4df6ff7b) means nothing to a person — what the core says about a test names it
// by its summary, else its Jira key; a test that is gone keeps its Jira key, a local one becomes « Untitled test »
export function testName(project: string | null, id: string): string {
  const ref = project ? localTestRef(project, id) : null;
  if (ref) return ref.summary.trim() || ref.key || UNTITLED_TEST;
  return id.startsWith("local-") ? UNTITLED_TEST : id;
}

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

export function batchName(project: string | null, docId: string, lot: string): string {
  const doc = project ? findDoc(project, docId) : null;
  return `${docName(project, docId)} · ${doc?.media?.find((b) => b.id === lot)?.title.trim() || lot}`;
}
