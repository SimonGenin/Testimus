import type { DocRef } from "../../core/types.ts";
import { call } from "../api.ts";

// ponytail: a passage that cannot be read says only that — whether its document was deleted is read from the
// list, by id or by code (a source may name either)
export async function docGone(docId: string): Promise<boolean> {
  try {
    const docs = await call<DocRef[]>("docs.list", {});
    return !docs.some((d) => d.id === docId || d.code === docId);
  } catch {
    return false;
  }
}

export const goneText = (docId: string) =>
  `${docId} is no longer a document of this project, so this source cannot be shown. Cite another document, or add ${docId} again: its sources come back where its anchors and quotes are unchanged.`;
