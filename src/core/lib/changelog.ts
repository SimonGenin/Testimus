import { readFileSync } from "node:fs";
import { compareVersions, parseVersion } from "./updates.ts";

export const UNRELEASED = "Unreleased";

export type ChangelogEntry = { version: string; items: string[] };

const HEADING = /^##\s+(\S+)(?:\s+[—–-]\s+\S+)?\s*$/;

// ponytail: CHANGELOG.md is « ## <version> » (no date: the team reads what changed, not when) then « - » lines (a line
// that does not start with « - » continues the one above); « Unreleased » first, then the versions newest first
// whatever their order in the file
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let at: ChangelogEntry | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const h = HEADING.exec(line);
    if (h && (h[1] === UNRELEASED || parseVersion(h[1]))) {
      at = { version: h[1], items: [] };
      entries.push(at);
    } else if (line.startsWith("#")) at = null;
    else if (!at || !line) continue;
    else if (/^[-*]\s+/.test(line)) at.items.push(line.replace(/^[-*]\s+/, ""));
    else if (at.items.length) at.items[at.items.length - 1] += ` ${line}`;
  }
  const rank = (e: ChangelogEntry) => (e.version === UNRELEASED ? 1 : 0);
  return entries.sort((a, b) => rank(b) - rank(a) || compareVersions(b.version, a.version));
}

// ponytail: a release's notes (release.json) are its changelog lines; notes written before the changelog are one paragraph
export const notesOf = (items: string[]): string => items.map((i) => `- ${i}`).join("\n");

export function itemsOf(notes: string): string[] {
  const listed = parseChangelog(`## 0.0.0\n${notes}`)[0]?.items ?? [];
  return listed.length ? listed : notes.trim() ? [notes.trim().replace(/\s*\r?\n\s*/g, " ")] : [];
}

// ponytail: publishing <version> renames « Unreleased » to it and opens an empty « Unreleased » above; refused when
// nothing is written there, or when the version is already in the file
export function releaseChangelog(text: string, version: string): string {
  const entries = parseChangelog(text);
  if (entries.some((e) => e.version === version)) throw new Error(`CHANGELOG.md already has a section ${version}.`);
  if (!entries.find((e) => e.version === UNRELEASED)?.items.length)
    throw new Error(
      `CHANGELOG.md has nothing under « ## ${UNRELEASED} »: say there what ${version} changes, then publish.`,
    );
  return text.replace(UNRELEASED_HEADING, `## ${UNRELEASED}\n\n## ${version}`);
}

const UNRELEASED_HEADING = /^##[ \t]+Unreleased[ \t]*\r?$/m;

export function addUnreleased(text: string, item: string): string {
  const line = item.trim();
  if (!line) return text;
  const at = UNRELEASED_HEADING.exec(text);
  if (!at) throw new Error(`CHANGELOG.md has no « ## ${UNRELEASED} » section.`);
  const rest = text.slice(at.index + at[0].length);
  const next = rest.search(/^##\s/m);
  const body = (next < 0 ? rest : rest.slice(0, next)).trimEnd();
  const tail = next < 0 ? "\n" : `\n\n${rest.slice(next)}`;
  return `${text.slice(0, at.index + at[0].length)}${body ? body : "\n"}\n- ${line}${tail}`;
}

export function readChangelog(): ChangelogEntry[] {
  try {
    return parseChangelog(readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"));
  } catch {
    return [];
  }
}
