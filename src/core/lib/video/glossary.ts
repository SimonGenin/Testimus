import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { glossaryOf } from "../../rag/glossary.ts";
import { fold, STOP_WORDS } from "../../rag/stem-fr.ts";
import { docDir, listDocs, readContext, readFigures } from "../docs.ts";
import { sha256 } from "../hash.ts";
import { isMediaDoc } from "../media.ts";
import { readProject } from "../project.ts";

// ponytail: Whisper reads at most 224 tokens of prompt, and the end of the passage before takes its share: the
// glossary gets 170 of them — some 60 to 80 terms, so they are chosen
export const GLOSSARY_TOKENS = 170;
const TAIL_CHARS = 150;
const MAX_TERMS = 120;

export type SpeechGlossary = {
  terms: string[];
  kept: string[];
  auto: boolean;
  prompt: string;
  tokens: number;
  budget: number;
  hash: string;
};

// ponytail: a careful count without the model's tokenizer — a code or an acronym breaks into about a token every
// three characters, and each term costs its comma
export const tokensOf = (term: string): number => Math.ceil(term.length / 3) + 1;

const COMMON = new Set(
  "NOTE NOTA FIGURE TABLE TABLEAU PAGE OK KO NOK OUI NON YES NO ET OU LE LA LES DE DES DU UN UNE THE AND OR OF TO IN ON FOR TBD TBC NA".split(
    " ",
  ),
);
const CODE = /\b\p{Lu}{1,5}[-\s]?\d{1,4}\p{Lu}?\b/gu;
const SIGLE = /\b\p{Lu}[\p{Lu}\d]{1,7}\b/gu;
const NAME = /(?<=[\p{Ll},;:)]\s)\p{Lu}\p{Ll}{3,}(?:\s\p{Lu}\p{Ll}{2,})?/gu;

function count(text: string, re: RegExp, into: Map<string, number>, weight = 1): void {
  for (const m of text.matchAll(re)) {
    const t = m[0].replace(/\s+/g, " ").trim();
    if (COMMON.has(t.toUpperCase()) || STOP_WORDS.has(fold(t))) continue;
    into.set(t, (into.get(t) ?? 0) + weight);
  }
}

// ponytail: what Whisper cannot guess — codes (S12, PR2), acronyms (PCC, DMI) and the names the documents write with
// a capital inside a sentence (Sectionneur, Propriétés) — taken from the written documents, their titles, what the
// team says of them and the texts read on the pictures, the most used first. Never the common words: the prompt only
// leans the model, and every term spent on a word it knows is one less for a word it does not
export function autoTerms(project: string): string[] {
  const seen = new Map<string, number>();
  for (const g of glossaryOf(project)) seen.set(g.abbr, (seen.get(g.abbr) ?? 0) + 50);
  for (const d of listDocs(project)) {
    count(`${d.code} ${d.title}`, SIGLE, seen, 5);
    count(readContext(project, d.id), SIGLE, seen, 5);
    count(readContext(project, d.id), CODE, seen, 5);
    for (const f of readFigures(project, d.id)) for (const l of f.labels ?? []) count(l, CODE, seen, 2);
    if (isMediaDoc(d)) continue;
    const file = join(docDir(project, d.id), "doc.md");
    if (!existsSync(file)) continue;
    const md = readFileSync(file, "utf8")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/[*_`|#]/g, " ");
    count(md, CODE, seen, 2);
    count(md, SIGLE, seen);
    count(md, NAME, seen);
  }
  return [...seen.entries()]
    .filter(([t, n]) => n >= 3 && t.length >= 2 && !/^\d+$/.test(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TERMS)
    .map(([t]) => t);
}

const LEAD: Record<string, string> = { fr: "Glossaire :", en: "Glossary:", de: "Glossar:", es: "Glosario:" };

// ponytail: the glossary as Whisper is given it — one real sentence (its punctuation and the capitals of its
// acronyms also set the tone of what is written), the terms in the order given until the budget is spent
export function promptOf(terms: string[], language: string): { prompt: string; tokens: number; kept: string[] } {
  const lead = LEAD[language.toLowerCase().slice(0, 2)] ?? "Glossary:";
  const kept: string[] = [];
  let tokens = tokensOf(lead);
  for (const t of terms.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (kept.includes(t)) continue;
    if (tokens + tokensOf(t) > GLOSSARY_TOKENS) break;
    kept.push(t);
    tokens += tokensOf(t);
  }
  return { prompt: kept.length ? `${lead} ${kept.join(", ")}.` : "", tokens: kept.length ? tokens : 0, kept };
}

// ponytail: the terms are the team's when it wrote them (project.json video.glossary), else the documents' own
export function speechGlossary(project: string): SpeechGlossary {
  const p = readProject(project);
  const own = p.video?.glossary;
  const terms = own ?? autoTerms(project);
  const made = promptOf(terms, p.language);
  return {
    terms,
    kept: made.kept,
    auto: !own,
    prompt: made.prompt,
    tokens: made.tokens,
    budget: GLOSSARY_TOKENS,
    hash: made.prompt ? sha256(made.prompt).slice(0, 12) : "",
  };
}

// ponytail: a passage is heard alone, so it loses what came before (« brake calculation » became « precalculation »):
// it is given the end of the passage before it in the same language, after the glossary — Whisper keeps the end of a
// prompt that is too long
export function promptFor(glossary: string, before: string | undefined): string {
  const tail = (before ?? "").replace(/\s+/g, " ").trim();
  const cut = tail.length > TAIL_CHARS ? tail.slice(tail.indexOf(" ", tail.length - TAIL_CHARS) + 1) : tail;
  return [glossary, cut].filter(Boolean).join(" ");
}
