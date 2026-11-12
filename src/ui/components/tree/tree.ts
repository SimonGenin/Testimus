import type { Folder, LocalTestRef } from "../../../core/types.ts";

/** what a tree files: a test of the project, or one a generation writes */
export type Filed = { summary: string; folder?: string };
export type Node<T extends Filed = LocalTestRef> = {
  name: string;
  path: string;
  tests: T[];
  folders: Node<T>[];
  total: number;
};

// the local tests nested by their Xray folder, folders and tests sorted by name, each folder counting what it holds
export function localTree<T extends Filed = LocalTestRef>(refs: T[], sorted = true): Node<T> {
  const root: Node<T> = { name: "/", path: "/", tests: [], folders: [], total: 0 };
  for (const r of refs) {
    let at = root;
    root.total++;
    let path = "";
    for (const part of (r.folder || "/").split("/").filter(Boolean)) {
      path += `/${part}`;
      let next = at.folders.find((f) => f.path === path);
      if (!next) {
        next = { name: part, path, tests: [], folders: [], total: 0 };
        at.folders.push(next);
      }
      next.total++;
      at = next;
    }
    at.tests.push(r);
  }
  const sort = (n: Node<T>) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    if (sorted) n.tests.sort((a, b) => a.summary.localeCompare(b.summary));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export const matches = (r: LocalTestRef, q: string) =>
  !q || `${r.key ?? ""} ${r.summary} ${r.id}`.toLowerCase().includes(q.toLowerCase());

// ponytail: an issue key or its bare number is a question only Jira answers (xray.search completes the number)
export const isKeyQuery = (q: string) => /^([A-Za-z][A-Za-z0-9]*-)?[0-9]+$/.test(q.trim());

export const ancestors = (path: string) => {
  const out = ["/"];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `/${part}`;
    out.push(at);
  }
  return out;
};

export const folderName = (path: string) => (path === "/" ? "Test Repository" : path);

export const findFolder = (f: Folder | null, path: string): Folder | null => {
  if (!f) return null;
  if (f.path === path) return f;
  for (const c of f.folders) {
    const hit = findFolder(c, path);
    if (hit) return hit;
  }
  return null;
};

export type FolderRow = { folder: Folder; depth: number };

export const flattenFolders = (
  f: Folder,
  open: (path: string) => boolean,
  depth = 0,
  out: FolderRow[] = [],
): FolderRow[] => {
  out.push({ folder: f, depth });
  if (open(f.path)) for (const c of f.folders) flattenFolders(c, open, depth + 1, out);
  return out;
};

// a row of tests.list: the test, and whether it still waits in Review (a generation not validated yet)
export type Listed = LocalTestRef & { awaiting?: boolean };
