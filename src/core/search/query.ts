import { REVIEWS, type Review, type SearchKind, type SyncState } from "../types.ts";

export const KINDS: readonly SearchKind[] = ["test", "document", "passage"];

const KIND_WORDS: Record<string, SearchKind> = {
  test: "test",
  tests: "test",
  step: "test",
  steps: "test",
  doc: "document",
  docs: "document",
  document: "document",
  documents: "document",
  passage: "passage",
  passages: "passage",
  text: "passage",
  texte: "passage",
};

const SYNCS: readonly SyncState[] = ["local", "modified", "synced", "remote-changed"];
const HAS = ["findings", "sources", "key", "images", "note"] as const;
const IS = ["generated", "awaiting", "dirty"] as const;

export type Has = (typeof HAS)[number];
export type Is = (typeof IS)[number];

export type Filters = {
  in?: SearchKind[];
  review?: Review[];
  sync?: SyncState[];
  label?: string[];
  folder?: string[];
  doc?: string[];
  has?: Has[];
  is?: Is[];
};

export type Query = {
  raw: string;
  terms: string[];
  phrases: string[];
  exclude: string[];
  filters: Filters;
  text: string;
};

const REVIEW_WORDS: Record<string, Review> = {
  fix: "to-fix",
  tofix: "to-fix",
  "to-fix": "to-fix",
  ok: "validated",
  valid: "validated",
};

function add<K extends keyof Filters>(f: Filters, key: K, value: NonNullable<Filters[K]>[number]): void {
  const list = (f[key] ?? []) as unknown[];
  if (!list.includes(value)) f[key] = [...list, value] as Filters[K];
}

function filter(f: Filters, key: string, value: string): boolean {
  const v = value.toLowerCase();
  if (!v) return false;
  if (key === "in" || key === "kind") {
    const kind = KIND_WORDS[v];
    if (!kind) return false;
    add(f, "in", kind);
  } else if (key === "review") {
    const r = REVIEW_WORDS[v] ?? REVIEWS.find((x) => x === v);
    if (!r) return false;
    add(f, "review", r);
  } else if (key === "sync") {
    const s = SYNCS.find((x) => x === v || x.startsWith(v));
    if (!s) return false;
    add(f, "sync", s);
  } else if (key === "has") {
    const h = HAS.find((x) => x === v || `${x}s` === v || x === `${v}s`);
    if (!h) return false;
    add(f, "has", h);
  } else if (key === "is") {
    const i = IS.find((x) => x === v);
    if (!i) return false;
    add(f, "is", i);
  } else if (key === "label" || key === "tag") add(f, "label", v);
  else if (key === "folder" || key === "dir") add(f, "folder", v.startsWith("/") ? v : `/${v}`);
  else if (key === "doc") add(f, "doc", v);
  else return false;
  return true;
}

// ponytail: Google-like — words, "exact phrases", -excluded words and key:value filters; an unknown key:value
// (an url, a code with a colon) stays text
export function parseQuery(raw: string): Query {
  const terms: string[] = [];
  const phrases: string[] = [];
  const exclude: string[] = [];
  const filters: Filters = {};
  const text: string[] = [];
  for (const m of raw.matchAll(/(-?)(?:([\p{L}]+):)?(?:"([^"]*)"?|(\S+))/gu)) {
    const [, neg, key, quoted, bare] = m;
    if (quoted !== undefined) {
      const p = quoted.trim();
      if (!p) continue;
      if (key && filter(filters, key, p)) continue;
      if (neg) exclude.push(p);
      else {
        phrases.push(p);
        text.push(p);
      }
      continue;
    }
    if (key && filter(filters, key, bare)) continue;
    const word = key ? `${key}:${bare}` : bare;
    if (neg && word.length > 1) exclude.push(word);
    else if (!neg) {
      terms.push(word);
      text.push(word);
    }
  }
  return { raw, terms, phrases, exclude, filters, text: text.join(" ") };
}

export const wants = (q: Query, kind: SearchKind) => !q.filters.in?.length || q.filters.in.includes(kind);

// ponytail: a filter only tests can answer (review:, label:, has:…) keeps the search on tests
export const testsOnly = (f: Filters) =>
  !!(f.review?.length || f.sync?.length || f.label?.length || f.folder?.length || f.has?.length || f.is?.length);
