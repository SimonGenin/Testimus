import { type Converted, guessDate, slug, uniqueKey } from "./convert.ts";

export const TEXT_CONVERTER = "text 1";

// ponytail: a text file is read as UTF-8 (its BOM dropped), and as Windows-1252 when it is not valid UTF-8 — the
// encoding a French .txt saved by Notepad on an older Windows has
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+(\S.*)$/;

// ponytail: a .md keeps its headings, each anchored by its number (« ## 2.1 Titre » → § 2.1) or its title's slug; a
// .txt is its text as it is, a line that starts with # escaped so it never reads as a heading. The text before the
// first heading (all of a .txt) is the section of the title line, anchored by the title's slug
export function convertText(bytes: Uint8Array, o: { markdown: boolean; title: string }): Converted {
  const text = decodeText(bytes).replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/­/g, "").replace(/<!--/g, "<! --");
  const used = new Set<string>();
  const lines = text.split("\n").map((l) => {
    const h = o.markdown ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l) : null;
    if (!h) return o.markdown ? l : l.replace(/^(\s*)#/, "$1\\#");
    const title = h[2];
    const n = NUMBERED.exec(title);
    const key = n && !used.has(n[1]) ? n[1] : uniqueKey(used, slug(title));
    used.add(key);
    return `${h[1]} ${title} <!-- § ${key} -->`;
  });
  const body = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const firstHeading = /^# (.+?) <!-- § /m.exec(body)?.[1];
  const title = firstHeading ?? o.title;
  const md = body.startsWith("# ") ? `${body}\n` : `# ${title} <!-- § ${uniqueKey(used, slug(title))} -->\n\n${body}\n`;
  return {
    md,
    figures: [],
    warnings: [],
    meta: { title, date: guessDate(text.slice(0, 2000)) },
    convertedWith: TEXT_CONVERTER,
  };
}
