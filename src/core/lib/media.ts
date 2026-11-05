import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { slug, uniqueKey } from "../rag/convert.ts";
import type { DocJson, FigureEntry, MediaItem, MediaLot } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { docDir, readDoc, readFigures, writeDoc, writeFigures } from "./docs.ts";
import { sha256 } from "./hash.ts";
import { readJson } from "./project.ts";

export const BODY = "body.md";
export const PHOTO = /\.(jpe?g|png|webp)$/i;
// ponytail: what a later phase reads (videos and sound need ffmpeg and Whisper, HEIC needs ffmpeg): refused for now
// with that reason, never as « not a photo »
export const LATER = /\.(heic|heif|mp4|mov|mkv|avi|webm|mp3|m4a|wav)$/i;
const LOT_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SIDE = 2000;

export type Picked = { path?: string; name?: string; dataBase64?: string };
export type Rejected = { name: string; why: string; code: "not-a-photo" | "later" | "duplicate" | "failed" };

export const lotAnchor = (lot: string) => `§lot-${lot}`;
export const itemAnchor = (lot: string, item: string) => `§lot-${lot}.${item}`;
export const itemFigure = (lot: string, item: string) => `fig:lot-${lot}.${item}`;
const figureFile = (lot: string, item: string) => `figures/lot-${lot}-${item}.jpg`;

// ponytail: an annex's anchors all start with lot- — the body of a document never has one, so a source tells by its
// anchor alone that it comes from an observation; the batch is the part up to the first dot
export function lotOfAnchor(anchor: string): string | null {
  return /^(?:§\s*|fig:)lot-([a-z0-9][a-z0-9-]*)(?:\.|$)/.exec(anchor.trim())?.[1] ?? null;
}

export function mediaDir(project: string, docId: string, lot?: string): string {
  if (lot !== undefined && !LOT_RE.test(lot))
    throw new UserError(`Invalid batch id "${lot}".`, "media.list gives the batches of a document.");
  return join(docDir(project, docId), "media", ...(lot === undefined ? [] : [lot]));
}

export function findLot(doc: DocJson, lot: string): MediaLot {
  const l = doc.media?.find((x) => x.id === lot);
  if (!l)
    throw new UserError(`${doc.id} has no batch ${lot}.`, `testimus media list --doc ${doc.id} gives its batches.`);
  return l;
}

// ponytail: doc.json is read again right before every change of a batch, so two jobs on the same document never write
// over each other's batches
export function updateLot(project: string, docId: string, lot: string, change: (l: MediaLot) => void): MediaLot {
  const doc = readDoc(project, docId);
  const l = findLot(doc, lot);
  change(l);
  writeDoc(project, doc);
  return l;
}

export function updateItem(
  project: string,
  docId: string,
  lot: string,
  item: string,
  change: (i: MediaItem) => void,
): void {
  updateLot(project, docId, lot, (l) => {
    const i = l.items.find((x) => x.id === item);
    if (i) change(i);
  });
}

export function newLot(project: string, docId: string, o: { title?: string; reference?: boolean; included?: boolean }) {
  const doc = readDoc(project, docId);
  const used = new Set((doc.media ?? []).map((l) => l.id));
  const title = o.title?.trim() || `Photos ${env.now().toISOString().slice(0, 10)}`;
  const base = slug(title).slice(0, 24).replace(/-+$/, "") || "lot";
  const lot: MediaLot = {
    id: uniqueKey(used, base),
    title,
    included: o.included ?? true,
    ...(o.reference ? { reference: true } : {}),
    added: env.now().toISOString(),
    items: [],
  };
  writeDoc(project, { ...doc, media: [...(doc.media ?? []), lot] });
  return lot;
}

export function readLotContext(project: string, docId: string, lot: string): string {
  const file = join(mediaDir(project, docId, lot), "context.md");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

export function writeLotContext(project: string, docId: string, lot: string, text: string): void {
  const t = text.trim();
  writeAtomic(join(mediaDir(project, docId, lot), "context.md"), t ? `${t}\n` : "");
}

export const nameOf = (p: Picked) => basename(p.name || p.path || "");

// ponytail: each photo is copied as it is under files/ (its own name, made unique), the same picture twice in a batch is
// refused, and what is not a photo is said why
export function copyFiles(
  project: string,
  docId: string,
  lot: string,
  files: Picked[],
): { items: MediaItem[]; rejected: Rejected[] } {
  const doc = readDoc(project, docId);
  const l = findLot(doc, lot);
  const dir = join(mediaDir(project, docId, lot), "files");
  const ids = new Set(l.items.map((i) => i.id));
  const names = new Set(l.items.map((i) => basename(i.file).toLowerCase()));
  const hashes = new Set(l.items.map((i) => i.sha256));
  const items: MediaItem[] = [];
  const rejected: Rejected[] = [];
  for (const f of files) {
    const name = nameOf(f);
    if (LATER.test(name)) {
      rejected.push({
        name,
        why: "Videos, sound and HEIC photos come in a later version: give JPEG, PNG or WebP photos for now.",
        code: "later",
      });
      continue;
    }
    if (!PHOTO.test(name)) {
      rejected.push({ name, why: "Only photos (JPEG, PNG, WebP) can be added to a batch.", code: "not-a-photo" });
      continue;
    }
    let data: Buffer;
    try {
      if (f.dataBase64 !== undefined) data = Buffer.from(f.dataBase64, "base64");
      else if (f.path && existsSync(f.path)) data = readFileSync(f.path);
      else throw new Error(`File not found: ${f.path ?? name}`);
    } catch (e) {
      rejected.push({ name, why: e instanceof Error ? e.message : String(e), code: "failed" });
      continue;
    }
    const hash = sha256(data);
    if (hashes.has(hash)) {
      rejected.push({ name, why: "This photo is already in the batch.", code: "duplicate" });
      continue;
    }
    hashes.add(hash);
    const stem = basename(name, extname(name));
    const id = uniqueKey(ids, slug(stem).slice(0, 40).replace(/-+$/, "") || "photo");
    let file = name.replace(/[\\/:*?"<>|]/g, "_");
    if (names.has(file.toLowerCase())) file = `${id}${extname(name).toLowerCase()}`;
    names.add(file.toLowerCase());
    writeAtomic(join(dir, file), data);
    items.push({ id, name, file: `files/${file}`, kind: "photo", sha256: hash, state: "new" });
  }
  updateLot(project, docId, lot, (x) => {
    x.items.push(...items);
  });
  return { items, rejected };
}

// ponytail: the earliest date written in the EXIF block (the shot, before any later edit), as local time
export function exifDate(exif: Uint8Array | undefined): string | undefined {
  if (!exif) return undefined;
  const text = Buffer.from(exif).toString("latin1");
  const dates = [...text.matchAll(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g)]
    .map((m) => `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)
    .filter((d) => !d.startsWith("0000"))
    .sort();
  return dates[0];
}

// ponytail: the picture Claude and the tester see — a JPEG of at most 2000 px a side, turned as the camera held it
// (EXIF orientation), a transparent PNG laid on white; the original stays as it was under files/
export async function preparePhoto(
  project: string,
  docId: string,
  lot: string,
  item: MediaItem,
): Promise<Pick<MediaItem, "figure" | "takenAt" | "width" | "height">> {
  const { default: sharp } = await import("sharp");
  const src = join(mediaDir(project, docId, lot), item.file);
  const input = readFileSync(src);
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const out = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const figure = figureFile(lot, item.id);
  writeAtomic(join(docDir(project, docId), figure), out.data);
  const takenAt = exifDate(meta.exif);
  return { figure, width: out.info.width, height: out.info.height, ...(takenAt ? { takenAt } : {}) };
}

// ponytail: a batch reads in the order the photos were taken; a photo without a date keeps its place after them
export function ordered(items: MediaItem[]): MediaItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) =>
      a.it.takenAt && b.it.takenAt
        ? a.it.takenAt.localeCompare(b.it.takenAt) || a.i - b.i
        : a.it.takenAt
          ? -1
          : b.it.takenAt
            ? 1
            : a.i - b.i,
    )
    .map((x) => x.it);
}

const WORDS = {
  fr: {
    annex: "Annexe",
    photos: (n: number) => `${n} photo${n > 1 ? "s" : ""}`,
    context: "Contexte du lot :",
    observed:
      "Photos du système réel : elles montrent comment il se comporte et comment faire, pas ce qu'il doit faire.",
    labels: "Texte visible :",
    illustrates: "Illustre",
    when: (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`,
  },
  en: {
    annex: "Annex",
    photos: (n: number) => `${n} photo${n > 1 ? "s" : ""}`,
    context: "Batch context:",
    observed:
      "Photos of the real system: they show how it behaves and how to do things, not what it is required to do.",
    labels: "Visible text:",
    illustrates: "Illustrates",
    when: (d: string) => `${d.slice(0, 10)} ${d.slice(11, 16)}`,
  },
};

const alt = (s: string) =>
  s
    .replace(/[[\]()<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ponytail: part.md — the annex as doc.md carries it: a heading for the batch, its context, then a section per photo
// (its picture, what Claude read in it, the text it shows, the sections of the body it illustrates); a photo Claude has
// not read yet still has its section and its picture
export function partMd(lot: MediaLot, context: string, figures: FigureEntry[], language: string): string {
  const w = language.toLowerCase().startsWith("fr") ? WORDS.fr : WORDS.en;
  const byAnchor = new Map(figures.map((f) => [f.anchor, f]));
  const photos = ordered(lot.items).filter((i) => i.figure);
  const out = [`# ${w.annex} — ${lot.title} <!-- § lot-${lot.id} -->`, ""];
  if (context) out.push(`${w.context} ${context.replace(/\s*\n\s*/g, " ")}`, "");
  out.push(`${w.photos(photos.length)}. ${w.observed}`, "");
  for (const it of photos) {
    const f = byAnchor.get(itemFigure(lot.id, it.id));
    const caption = alt(it.takenAt ? `${it.name} — ${w.when(it.takenAt)}` : it.name);
    out.push(`## ${alt(basename(it.name, extname(it.name)))} <!-- § lot-${lot.id}.${it.id} -->`, "");
    out.push(`![${caption}](${it.figure}) <!-- fig lot-${lot.id}.${it.id} -->`, "");
    if (f?.description.trim()) out.push(f.description.trim(), "");
    if (f?.labels?.length) out.push(`${w.labels} ${f.labels.map((l) => `« ${l} »`).join(" · ")}`, "");
    if (it.illustrates?.length) out.push(`${w.illustrates} ${it.illustrates.join(", ")}.`, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function writePart(project: string, docId: string, lot: string, language: string): void {
  const doc = readDoc(project, docId);
  const l = findLot(doc, lot);
  const md = partMd(l, readLotContext(project, docId, lot), readFigures(project, docId), language);
  writeAtomic(join(mediaDir(project, docId, lot), "part.md"), md);
}

// ponytail: the figure entry of a photo — its caption is the picture's line in the annex, what Claude read stays
export function photoFigure(lot: MediaLot, it: MediaItem, previous?: FigureEntry): FigureEntry {
  return {
    file: it.figure ?? "",
    anchor: itemFigure(lot.id, it.id),
    caption: previous?.caption || it.name,
    description: previous?.description ?? "",
    ...(previous?.labels ? { labels: previous.labels } : {}),
    kind: previous?.kind ?? "photo",
  };
}

// ponytail: figures.json keeps an entry per photo of every batch (included or not), next to the document's own
export function syncLotFigures(project: string, docId: string, lot: string): void {
  const doc = readDoc(project, docId);
  const l = findLot(doc, lot);
  const prefix = `fig:lot-${lot}.`;
  const all = readFigures(project, docId);
  const mine = new Map(all.filter((f) => f.anchor.startsWith(prefix)).map((f) => [f.anchor, f]));
  const kept = all.filter((f) => !f.anchor.startsWith(prefix));
  const photos = ordered(l.items)
    .filter((i) => i.figure)
    .map((i) => photoFigure(l, i, mine.get(itemFigure(lot, i.id))));
  writeFigures(project, docId, [...kept, ...photos]);
}

// ponytail: the converted text without its annexes — body.md, else doc.md cut where the first annex starts (a document
// converted before batches existed); null while the document is not converted
export function bodyOf(dir: string): string | null {
  const body = join(dir, BODY);
  if (existsSync(body)) return readFileSync(body, "utf8");
  const doc = join(dir, "doc.md");
  if (!existsSync(doc)) return null;
  const md = readFileSync(doc, "utf8");
  const at = md.search(/^# .*<!-- § lot-/m);
  return at < 0 ? md : `${md.slice(0, at).trimEnd()}\n`;
}

// ponytail: doc.md = the body, then the part.md of each included batch in the order of the batches — assembled, never
// edited by hand; true when doc.md changed
export function assembleDir(dir: string): boolean {
  const body = bodyOf(dir);
  if (body === null) return false;
  if (!existsSync(join(dir, BODY))) writeAtomic(join(dir, BODY), body);
  const doc = readJson<Partial<DocJson>>(join(dir, "doc.json"), {});
  const parts = (doc.media ?? [])
    .filter((l) => l.included && LOT_RE.test(l.id))
    .map((l) => join(dir, "media", l.id, "part.md"))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, "utf8").trim())
    .filter(Boolean);
  const md = parts.length ? `${body.trimEnd()}\n\n${parts.join("\n\n")}\n` : body;
  const file = join(dir, "doc.md");
  if (existsSync(file) && readFileSync(file, "utf8") === md) return false;
  writeAtomic(file, md);
  return true;
}

export const assemble = (project: string, docId: string) => assembleDir(docDir(project, docId));

// ponytail: a batch goes with everything it put in the document's folder — its folder, its pictures, their entries
export function dropLot(project: string, docId: string, lot: string): void {
  const doc = readDoc(project, docId);
  findLot(doc, lot);
  rmSync(mediaDir(project, docId, lot), { recursive: true, force: true });
  const figs = join(docDir(project, docId), "figures");
  if (existsSync(figs)) for (const f of readdirSync(figs)) if (f.startsWith(`lot-${lot}-`)) rmSync(join(figs, f));
  writeFigures(
    project,
    docId,
    readFigures(project, docId).filter((f) => !f.anchor.startsWith(`fig:lot-${lot}.`)),
  );
  writeDoc(project, { ...doc, media: (doc.media ?? []).filter((l) => l.id !== lot) });
}

export function dropItem(project: string, docId: string, lot: string, item: string): MediaItem {
  const doc = readDoc(project, docId);
  const l = findLot(doc, lot);
  const it = l.items.find((i) => i.id === item);
  if (!it)
    throw new UserError(
      `The batch ${lot} has no item ${item}.`,
      `testimus media show ${docId} ${lot} lists its items.`,
    );
  rmSync(join(mediaDir(project, docId, lot), it.file), { force: true });
  if (it.figure) rmSync(join(docDir(project, docId), it.figure), { force: true });
  writeFigures(
    project,
    docId,
    readFigures(project, docId).filter((f) => f.anchor !== itemFigure(lot, item)),
  );
  l.items = l.items.filter((i) => i.id !== item);
  writeDoc(project, doc);
  return it;
}

// ponytail: a batch's state as a list shows it — what is still to prepare or to read, what failed
export function lotCounts(l: MediaLot) {
  return {
    photos: l.items.length,
    videos: 0,
    analysed: l.items.filter((i) => i.state === "analysed").length,
    failed: l.items.filter((i) => i.state === "failed").length,
  };
}

export function ensureMediaDir(project: string, docId: string, lot: string): void {
  mkdirSync(mediaDir(project, docId, lot), { recursive: true });
}
