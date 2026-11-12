import type { DocRef } from "../../../core/types.ts";

export type DocGroup = { key: string; name: string; path: string; docs: DocRef[] };

export const ONE_BY_ONE = "Added one by one";

// ponytail: the folder a document was imported from — the parent of the path it came from on this PC; an upload or a
// document added by name alone has none
function folderOf(d: DocRef): string {
  const name = d.source?.name ?? "";
  const at = Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"));
  return at > 0 ? name.slice(0, at) : "";
}

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

// ponytail: the documents by the folder they were imported from, in the order they come; one group alone is no group
export function docGroups(docs: DocRef[]): DocGroup[] {
  const groups: DocGroup[] = [];
  for (const d of docs) {
    const path = folderOf(d);
    let g = groups.find((x) => x.key === path);
    if (!g) {
      g = { key: path, name: path ? lastPart(path) : ONE_BY_ONE, path, docs: [] };
      groups.push(g);
    }
    g.docs.push(d);
  }
  return groups.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1));
}
