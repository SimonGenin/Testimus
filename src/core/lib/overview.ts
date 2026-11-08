import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunKind } from "../claude/access.ts";
import { env } from "../env.ts";
import type { DocJson } from "../types.ts";
import { fileMtime, writeAtomic } from "./atomic.ts";
import { contentOf, docIds, readDoc } from "./docs.ts";
import { sha256 } from "./hash.ts";
import { readJson, readProject, writeJson } from "./project.ts";

// ponytail: docs/OVERVIEW.md — what Claude wrote about how the documents fit together, the team's to edit. A small
// frontmatter the core owns (when, after what, what each document was when it was read, what that update changed),
// then a section `##` per document (its heading ends `<!-- doc <id> -->`) and the sections across them

export const OVERVIEW_PATH = "docs/OVERVIEW.md";

export type SectionChanges = { modified: string[]; added: string[]; removed: string[] };
export type OverviewMeta = {
  updatedAt?: string;
  updatedAfter?: string;
  basis: Record<string, string>;
} & Partial<SectionChanges>;
export type Overview = { exists: boolean; meta: OverviewMeta; body: string; mtime: number };
export type DocChange = { id: string; change: "added" | "converted" | "removed"; title: string };
export type Section = { key: string; title: string; doc?: string; text: string };

export const overviewFile = (project: string) => join(project, "docs", "OVERVIEW.md");
const lastFile = (project: string) => join(project, ".testimus", "overview", "last.json");

export function overviewOption(project: string): { enabled: boolean; inEveryRun: boolean } {
  const o = readProject(project).claude.overview;
  return { enabled: !!o?.enabled, inEveryRun: !!o?.enabled && !!o.inEveryRun };
}

const bare = (v: string) => {
  const t = v.trim();
  if (!t.startsWith('"')) return t;
  try {
    return String(JSON.parse(t));
  } catch {
    return t.slice(1, t.endsWith('"') ? -1 : undefined);
  }
};
const line = (v: string) => (/^\s|\s$|^["[{-]|[\r\n:#]/.test(v) ? JSON.stringify(v) : v);
const LISTS = ["modified", "added", "removed"] as const;

export function parseOverview(text: string): { meta: OverviewMeta; body: string } {
  const src = text.replace(/^﻿/, "");
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const meta: OverviewMeta = { basis: {} };
  if (!m) return { meta, body: src };
  let key = "";
  for (const l of m[1].split(/\r?\n/)) {
    const top = l.match(/^(\w+):\s*(.*)$/);
    if (top) {
      key = top[1];
      if (key === "updatedAt" || key === "updatedAfter") meta[key] = bare(top[2]);
      if ((LISTS as readonly string[]).includes(key)) meta[key as (typeof LISTS)[number]] = [];
      continue;
    }
    const pair = l.match(/^\s+([^\s:][^:]*):\s*(\S+)\s*$/);
    if (key === "basis" && pair) meta.basis[bare(pair[1])] = bare(pair[2]);
    const item = l.match(/^\s*-\s*(.*)$/);
    if (item && (LISTS as readonly string[]).includes(key)) meta[key as (typeof LISTS)[number]]?.push(bare(item[1]));
  }
  return { meta, body: src.slice(m[0].length) };
}

export function formatOverview(meta: OverviewMeta, body: string): string {
  const head = ["---"];
  if (meta.updatedAt) head.push(`updatedAt: ${meta.updatedAt}`);
  if (meta.updatedAfter) head.push(`updatedAfter: ${line(meta.updatedAfter)}`);
  head.push("basis:", ...Object.entries(meta.basis).map(([id, print]) => `  ${id}: ${print}`));
  for (const k of LISTS) if (meta[k]?.length) head.push(`${k}:`, ...(meta[k] ?? []).map((t) => `  - ${line(t)}`));
  head.push("---", "");
  return `${head.join("\n")}${body.replace(/^\s*\n/, "")}`;
}

export function readOverview(project: string): Overview {
  const file = overviewFile(project);
  if (!existsSync(file)) return { exists: false, meta: { basis: {} }, body: "", mtime: 0 };
  return { exists: true, ...parseOverview(readFileSync(file, "utf8")), mtime: fileMtime(file) };
}

export function writeOverview(project: string, meta: OverviewMeta, body: string): void {
  writeAtomic(overviewFile(project), formatOverview(meta, body));
}

// ponytail: what a document was when Claude last read it — its text (doc.md and what was read of its pictures, as the
// index compares it) and what doc.json says of it that the overview speaks of; 12 hex are plenty for a few hundred
function printOf(project: string, doc: DocJson): string {
  const facts = [doc.version, doc.date, doc.kind, doc.status, doc.amends, doc.relatesTo, doc.reference];
  return sha256(JSON.stringify([contentOf(project, doc), facts])).slice(0, 12);
}

export function basisOf(project: string): Record<string, string> {
  return Object.fromEntries(docIds(project).map((id) => [id, printOf(project, readDoc(project, id))]));
}

export function changesSince(project: string, basis: Record<string, string>, now: Record<string, string>) {
  const out: DocChange[] = [];
  const title = (id: string) => {
    const d = readDoc(project, id);
    return d.title || d.code || id;
  };
  for (const [id, print] of Object.entries(now))
    if (!(id in basis)) out.push({ id, change: "added", title: title(id) });
    else if (basis[id] !== print) out.push({ id, change: "converted", title: title(id) });
  for (const id of Object.keys(basis)) if (!(id in now)) out.push({ id, change: "removed", title: id });
  return out;
}

const DOC_MARK = /<!--\s*doc\s+(\S+?)\s*-->/;
const titleOf = (heading: string) => heading.replace(/<!--[\s\S]*?-->/g, "").trim();

// ponytail: only `##` cuts a section (### stays inside it); what comes before the first is the preamble (key "")
export function sectionsOf(body: string): Section[] {
  const out: Section[] = [];
  let cur: Section = { key: "", title: "", text: "" };
  for (const l of body.replace(/\r?\n$/, "").split(/\r?\n/)) {
    const h = l.match(/^##\s+(.*)$/);
    if (h) {
      if (cur.key || cur.text.trim()) out.push(cur);
      const doc = h[1].match(DOC_MARK)?.[1];
      const title = titleOf(h[1]);
      cur = { key: doc ? `doc:${doc}` : `title:${title.toLowerCase()}`, title, ...(doc && { doc }), text: "" };
      continue;
    }
    cur.text += `${l}\n`;
  }
  if (cur.key || cur.text.trim()) out.push(cur);
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function sectionDiff(before: Section[], after: Section[]): SectionChanges {
  const was = new Map(before.map((s) => [s.key, s]));
  const now = new Set(after.map((s) => s.key));
  const named = (s: Section) => s.title || "Introduction";
  return {
    modified: after.filter((s) => was.has(s.key) && norm(was.get(s.key)?.text ?? "") !== norm(s.text)).map(named),
    added: after.filter((s) => !was.has(s.key) && (s.key || s.text.trim())).map(named),
    removed: before.filter((s) => !now.has(s.key)).map(named),
  };
}

// ponytail: an update after an import may touch the sections of the documents that changed and those across them —
// a document's section that did not change must come back word for word (spaces aside); a document added needs one,
// a document removed loses its own
export function overviewWarnings(before: Section[], after: Section[], changes: DocChange[]): string[] {
  const touched = new Set(changes.map((c) => c.id));
  const now = new Map(after.map((s) => [s.key, s]));
  const out: string[] = [];
  for (const s of before) {
    if (!s.doc || touched.has(s.doc)) continue;
    const a = now.get(s.key);
    if (!a) out.push(`Claude removed the section « ${s.title} », though its document did not change.`);
    else if (norm(a.text) !== norm(s.text) || a.title !== s.title)
      out.push(`Claude changed the section « ${s.title} », though its document did not change.`);
  }
  for (const c of changes) {
    const has = now.has(`doc:${c.id}`);
    if (c.change === "added" && !has) out.push(`No section for « ${c.title} », added since the last update.`);
    if (c.change === "removed" && has) out.push(`The section of ${c.id} is still there, though it was removed.`);
  }
  return out;
}

export type LastUpdate = { at: string; before: string; after: string };

// ponytail: the text before and after the last update, for « Show changes » — this PC's (derived, not shared)
export function keepLastUpdate(project: string, before: string, after: string): void {
  writeJson(lastFile(project), { at: env.now().toISOString(), before, after } satisfies LastUpdate);
}

export function readLastUpdate(project: string): LastUpdate | null {
  const l = readJson<Partial<LastUpdate>>(lastFile(project), {});
  return typeof l.before === "string" && typeof l.after === "string" ? (l as LastUpdate) : null;
}

const NOT_GIVEN: RunKind[] = ["overview", "figures", "headers", "media"];

export const OVERVIEW_LINE =
  "Before you start, read docs/OVERVIEW.md: how the project's documents fit together (what each one is, how they link, amend or contradict each other). It is background written by Claude; the documents stay the only sources.";

// ponytail: a pointer, not the text — Claude reads the file once when the run needs it, and a run that only looks at
// pictures or passages (figures, headers, media) is not told: they describe what they see, not how documents link
export function withOverview(project: string, kind: RunKind, prompt: string): string {
  if (NOT_GIVEN.includes(kind) || !overviewOption(project).inEveryRun || !existsSync(overviewFile(project)))
    return prompt;
  return `${prompt.replace(/\n*$/, "")}\n\n${OVERVIEW_LINE}\n`;
}
