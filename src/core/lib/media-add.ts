import { existsSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { env } from "../env.ts";
import type { DocJson, DocKind } from "../types.ts";
import { docDir, readDoc } from "./docs.ts";
import { idOf } from "./docs-folder.ts";
import {
  copyMediaFiles,
  isImage,
  isVideo,
  nameOf,
  newMediaDoc,
  type OnCopy,
  type Picked,
  type Rejected,
} from "./media.ts";

// ponytail: a free id from a name — the code read from it, made a valid folder name, -2, -3… when taken
export function freeId(project: string, name: string, taken = new Set<string>()): string {
  const base = idOf(name);
  let id = base;
  for (let k = 2; existsSync(join(project, "docs", id)) || taken.has(id.toLowerCase()); k++) id = `${base}-${k}`;
  taken.add(id.toLowerCase());
  return id;
}

export type ImagesMode = "together" | "each";

// ponytail: images picked together are one document (together) or one document each; a video is always a document of
// its own. A group's title is the one given, else its folder's name, else « Images <date> »; each file's title is its
// name without extension. Nothing is converted here (docs.convert, or media.add's own conversion)
export async function addMediaDocs(
  project: string,
  picked: Picked[],
  o: { images?: ImagesMode; title?: string; kind?: DocKind; uploaded?: boolean; id?: string },
  signal?: AbortSignal,
  onCopy?: OnCopy,
): Promise<{ added: DocJson[]; rejected: Rejected[] }> {
  const taken = new Set<string>();
  const images = picked.filter((p) => isImage(nameOf(p)));
  const videos = picked.filter((p) => isVideo(nameOf(p)));
  const groups: { title: string; files: Picked[] }[] = [
    ...(o.images === "each" || images.length === 1
      ? images.map((p) => ({
          title: o.title?.trim() && images.length === 1 ? o.title.trim() : stem(nameOf(p)),
          files: [p],
        }))
      : images.length
        ? [{ title: o.title?.trim() || `Images ${env.now().toISOString().slice(0, 10)}`, files: images }]
        : []),
    ...videos.map((p) => ({
      title: o.title?.trim() && videos.length === 1 && !images.length ? o.title.trim() : stem(nameOf(p)),
      files: [p],
    })),
  ];
  const added: DocJson[] = [];
  const rejected: Rejected[] = [];
  for (const g of groups) {
    const id = o.id && groups.length === 1 ? freeId(project, o.id, taken) : freeId(project, g.title, taken);
    const first = g.files[0];
    newMediaDoc(project, {
      id,
      title: g.title,
      kind: o.kind,
      name: first.path ?? nameOf(first),
      uploaded: o.uploaded || !first.path,
    });
    let r: Awaited<ReturnType<typeof copyMediaFiles>>;
    try {
      r = await copyMediaFiles(project, id, g.files, signal, onCopy);
    } catch (e) {
      rmSync(docDir(project, id), { recursive: true, force: true });
      throw e;
    }
    rejected.push(...r.rejected);
    if (!r.added.length) {
      rmSync(docDir(project, id), { recursive: true, force: true });
      continue;
    }
    added.push(readDoc(project, id));
  }
  return { added, rejected };
}

const stem = (name: string) => basename(name, extname(name));
