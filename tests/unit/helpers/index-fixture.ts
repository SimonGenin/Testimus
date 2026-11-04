import { markIndexedInDb } from "./index-state.ts";

// ponytail: the index state lives in rag.db now (formats F7); kept under this name for the tests that use it
export function markIndexed(project: string, only?: string[]): void {
  markIndexedInDb(project, only);
}
