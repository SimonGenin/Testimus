import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { env } from "../env.ts";
import { normalizeAnchor } from "../rag/anchors.ts";
import { anchorsOf } from "../rag/convert.ts";
import type { DocJson, FigureEntry, MediaFile } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { recheckMechanical, testsCiting } from "./check.ts";
import { docDir, docIds, readFigures, writeContext, writeDoc, writeFigures } from "./docs.ts";
import { imageAnchor, imageEntry, ordered, withFiles } from "./media.ts";
import { MEDIA_SECTION, writeMediaMd } from "./media-md.ts";
import { MEDIA_CONVERTER } from "./media-pipeline.ts";
import { readJson } from "./project.ts";

// ponytail: the shape of a batch of photos as doc.json.media held it until 2026-11-08 — read here only, to migrate it
type LegacyItem = {
  id: string;
  name: string;
  file: string;
  sha256: string;
  figure?: string;
  takenAt?: string;
  width?: number;
  height?: number;
  state: MediaFile["state"];
  error?: string;
};
type LegacyLot = { id: string; title: string; reference?: boolean; added: string; items: LegacyItem[] };

export type Rewritten = { test: string; from: string; to: string };
export type Migrated = { from: string; lot: string; doc: string; title: string; images: number };
export type MigrationReport = { migrated: Migrated[]; rewritten: Rewritten[]; dryRun: boolean };

const LOT_ANCHOR = /^(?:§|fig:)lot-([a-z0-9][a-z0-9-]*?)(?:\.([a-z0-9][a-z0-9-]*))?$/;

function lotsOf(project: string, id: string): LegacyLot[] {
  const raw = readJson<{ media?: LegacyLot[] }>(join(docDir(project, id), "doc.json"), {});
  return Array.isArray(raw.media) ? raw.media : [];
}

export function needsMigration(project: string): boolean {
  return docIds(project).some((id) => lotsOf(project, id).length > 0);
}

function newId(project: string, parent: string, lot: string, taken: Set<string>): string {
  const base = `${parent}-${lot}`.slice(0, 120);
  let id = base;
  for (let k = 2; existsSync(docDir(project, id)) || taken.has(id); k++) id = `${base}-${k}`;
  taken.add(id);
  return id;
}

// ponytail: a lot-… anchor of the parent's annex, as the new images document names it — the annex's heading is the
// document's head section, a photo is its picture
function mapAnchor(anchor: string, plans: Map<string, { doc: string; items: Map<string, number> }>): string | null {
  const m = LOT_ANCHOR.exec(normalizeAnchor(anchor));
  const plan = m ? plans.get(m[1]) : undefined;
  if (!m || !plan) return null;
  if (!m[2]) return `${plan.doc}#§${MEDIA_SECTION}`;
  const n = plan.items.get(m[2]);
  return n ? `${plan.doc}#${imageAnchor(n)}` : null;
}

// ponytail: every source line of the tests that names a migrated photo by the parent's id or code is rewritten to the
// new document's anchor — mechanically, the rest of the line (quote, @column) kept as it was
function rewriteTests(
  project: string,
  parent: DocJson,
  plans: Map<string, { doc: string; items: Map<string, number> }>,
  dryRun: boolean,
): Rewritten[] {
  const root = join(project, "tests");
  const out: Rewritten[] = [];
  if (!existsSync(root)) return out;
  const names = new Set([parent.id, parent.code].filter(Boolean));
  for (const test of readdirSync(root)) {
    const file = join(root, test, "test.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    let inSources = false;
    let changed = false;
    const lines = text.split("\n").map((line) => {
      if (/^#{1,6}\s/.test(line)) inSources = /^###\s+Sources\s*$/i.test(line.trim());
      if (!inSources) return line;
      const m = /^(\s*[-*]\s+)([^#\s"]+)#(\S+)(.*)$/.exec(line);
      if (!m || !names.has(m[2])) return line;
      const to = mapAnchor(m[3], plans);
      if (!to) return line;
      out.push({ test, from: `${m[2]}#${m[3]}`, to });
      changed = true;
      return `${m[1]}${to}${m[4]}`;
    });
    if (changed && !dryRun) writeAtomic(file, lines.join("\n"));
  }
  return out;
}

function migrateLot(project: string, parent: DocJson, lot: LegacyLot, id: string): Migrated {
  const from = docDir(project, parent.id);
  const lotDir = join(from, "media", lot.id);
  const dir = docDir(project, id);
  mkdirSync(join(dir, "files"), { recursive: true });
  const figures = new Map(readFigures(project, parent.id).map((f) => [f.anchor, f]));
  const files: MediaFile[] = [];
  const entries: FigureEntry[] = [];
  for (const [i, it] of ordered(lot.items.map((x, k) => ({ ...x, n: k + 1 }))).entries()) {
    const n = i + 1;
    const src = join(lotDir, it.file);
    const name = basename(it.file);
    if (existsSync(src)) writeAtomic(join(dir, "files", name), readFileSync(src));
    const pic = it.figure ? join(from, it.figure) : "";
    const has = !!pic && existsSync(pic);
    if (has) {
      mkdirSync(join(dir, "figures"), { recursive: true });
      writeAtomic(join(dir, "figures", `img-${n}.jpg`), readFileSync(pic));
    }
    const f: MediaFile = {
      n,
      name: it.name,
      file: `files/${name}`,
      kind: "image",
      sha256: it.sha256,
      ...(has ? { figure: `figures/img-${n}.jpg` } : {}),
      ...(it.takenAt ? { takenAt: it.takenAt } : {}),
      ...(it.width ? { width: it.width, height: it.height } : {}),
      state: has ? (it.state === "analysed" ? "analysed" : "ready") : "new",
      ...(it.error ? { error: it.error } : {}),
    };
    files.push(f);
    if (has) entries.push(imageEntry(f, figures.get(`fig:lot-${lot.id}.${it.id}`)));
  }
  const doc: DocJson = withFiles(
    {
      id,
      code: id,
      title: lot.title,
      version: "",
      date: lot.added.slice(0, 10),
      kind: "other",
      status: "draft",
      source: { type: "images", name: files[0]?.name ?? lot.title, file: "files", sha256: "" },
      ...(lot.reference ? { reference: true } : {}),
      relatesTo: [parent.id],
    },
    files,
  );
  writeDoc(project, doc);
  writeFigures(project, id, entries);
  const context = existsSync(join(lotDir, "context.md")) ? readFileSync(join(lotDir, "context.md"), "utf8").trim() : "";
  if (context) writeContext(project, id, context);
  writeMediaMd(project, id);
  const md = readFileSync(join(dir, "doc.md"), "utf8");
  writeDoc(project, {
    ...doc,
    converted: {
      with: MEDIA_CONVERTER,
      at: env.now().toISOString(),
      warnings: [],
      stats: { sections: anchorsOf(md).sections.length, figures: entries.length, chars: md.length },
    },
  });
  return { from: parent.id, lot: lot.id, doc: id, title: lot.title, images: files.length };
}

// ponytail: the parent is left as it was before its first batch — doc.md is its body again (body.md, else doc.md cut
// where the first annex starts), the batches' folders, pictures and figure entries go, doc.json loses media
function cleanParent(project: string, id: string): void {
  const dir = docDir(project, id);
  const body = join(dir, "body.md");
  const md = join(dir, "doc.md");
  if (existsSync(body)) {
    writeAtomic(md, readFileSync(body, "utf8"));
    rmSync(body);
  } else if (existsSync(md)) {
    const text = readFileSync(md, "utf8");
    const at = text.search(/^# .*<!-- § lot-/m);
    if (at >= 0) writeAtomic(md, `${text.slice(0, at).trimEnd()}\n`);
  }
  rmSync(join(dir, "media"), { recursive: true, force: true });
  const figs = join(dir, "figures");
  if (existsSync(figs)) for (const f of readdirSync(figs)) if (f.startsWith("lot-")) rmSync(join(figs, f));
  writeFigures(
    project,
    id,
    readFigures(project, id).filter((f) => !f.anchor.startsWith("fig:lot-")),
  );
  const raw = readJson<Record<string, unknown>>(join(dir, "doc.json"), {});
  delete raw.media;
  writeDoc(project, { ...(raw as unknown as DocJson), id });
}

// ponytail: each batch of photos a document held as an annex (doc.json.media, until 2026-11-08) becomes an images
// document of its own — its photos numbered in the order they were taken (img:1…), what Claude read kept, its context
// its context.md, reference kept, relatesTo naming the document it was attached to; the tests' sources that cited the
// annex are rewritten to the new anchors (the report lists each line). Idempotent: a project without batches is left
// as it is. dryRun says what would happen
export function migrateMedia(project: string, dryRun = false): MigrationReport {
  const report: MigrationReport = { migrated: [], rewritten: [], dryRun };
  const taken = new Set<string>();
  const touched = new Set<string>();
  for (const parentId of docIds(project)) {
    const lots = lotsOf(project, parentId);
    if (!lots.length) continue;
    const raw = readJson<DocJson>(join(docDir(project, parentId), "doc.json"), {} as DocJson);
    const parent: DocJson = { ...raw, id: parentId };
    const plans = new Map<string, { doc: string; items: Map<string, number> }>();
    for (const lot of lots) {
      const id = newId(project, parentId, lot.id, taken);
      const items = new Map(
        ordered(lot.items.map((x, k) => ({ ...x, n: k + 1 }))).map((it, i) => [it.id, i + 1] as const),
      );
      plans.set(lot.id, { doc: id, items });
      if (dryRun)
        report.migrated.push({ from: parentId, lot: lot.id, doc: id, title: lot.title, images: lot.items.length });
      else report.migrated.push(migrateLot(project, parent, lot, id));
    }
    const rewritten = rewriteTests(project, parent, plans, dryRun);
    report.rewritten.push(...rewritten);
    for (const r of rewritten) touched.add(r.test);
    if (dryRun) continue;
    cleanParent(project, parentId);
    for (const t of testsCiting(project, parent)) touched.add(t.id);
  }
  if (!dryRun && touched.size) recheckMechanical(project, [...touched]);
  return report;
}

const done = new Set<string>();

// ponytail: run once per project and process, before the first command that names it — a project shared by a
// colleague on an older version is migrated the first time this version opens it
export function migrateOnOpen(project: string): MigrationReport | null {
  const key = resolve(project).toLowerCase();
  if (done.has(key)) return null;
  done.add(key);
  if (!existsSync(join(project, "docs")) || !needsMigration(project)) return null;
  const report = migrateMedia(project);
  writeAtomic(
    join(project, ".testimus", "migrations", `media-${env.now().toISOString().replace(/[:.]/g, "-")}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
