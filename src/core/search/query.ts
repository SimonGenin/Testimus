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
  /** me, none, or part of a name (accents and case ignored) */
  assignee?: string[];
};

export type FilterKey = keyof Filters;

/** a key:value of the query read as a filter — `known` false when its key is a filter's and its value is not one */
export type Used = { token: string; key: FilterKey; value: string; known: boolean };

export type Query = {
  raw: string;
  terms: string[];
  phrases: string[];
  exclude: string[];
  filters: Filters;
  used: Used[];
  text: string;
};

const KEYS: Record<string, FilterKey> = {
  in: "in",
  kind: "in",
  review: "review",
  sync: "sync",
  has: "has",
  is: "is",
  label: "label",
  tag: "label",
  folder: "folder",
  dir: "folder",
  doc: "doc",
  assignee: "assignee",
  assigned: "assignee",
  who: "assignee",
};

export const keyOf = (word: string): FilterKey | undefined => KEYS[word.toLowerCase()];

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

/** the value a filter keeps for what was typed, or undefined when the key does not take it */
export function filterValue(key: FilterKey, value: string): string | undefined {
  const v = value.toLowerCase();
  if (!v) return undefined;
  if (key === "in") return KIND_WORDS[v];
  if (key === "review") return REVIEW_WORDS[v] ?? REVIEWS.find((x) => x === v);
  if (key === "sync") return SYNCS.find((x) => x === v || x.startsWith(v));
  if (key === "has") return HAS.find((x) => x === v || `${x}s` === v || x === `${v}s`);
  if (key === "is") return IS.find((x) => x === v);
  if (key === "folder") return v.startsWith("/") ? v : `/${v}`;
  if (key === "assignee") return v === "nobody" || v === "unassigned" ? "none" : plainName(v);
  return v;
}

/** a name as the assignee filter compares it: lower case, accents off */
export const plainName = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** what each key takes when it is a fixed list (the others take any label, folder or document id) */
export const CHOICES: Partial<Record<FilterKey, readonly string[]>> = {
  in: ["tests", "docs", "passages"],
  review: REVIEWS,
  sync: SYNCS,
  has: HAS,
  is: IS,
};

// ponytail: Google-like — words, "exact phrases", -excluded words and key:value filters; an unknown key:value
// (an url, a code with a colon) stays text, a filter's key with a value it does not take is reported (`known`
// false) and left out, and a filter's key with no value yet (« label: ») is nothing
export function parseQuery(raw: string): Query {
  const terms: string[] = [];
  const phrases: string[] = [];
  const exclude: string[] = [];
  const filters: Filters = {};
  const used: Used[] = [];
  const text: string[] = [];
  for (const m of raw.matchAll(/(-?)(?:([\p{L}]+):)?(?:"([^"]*)"?|(\S+))/gu)) {
    const [token, neg, rawKey, quoted, bare] = m;
    if (!rawKey && bare && /^\p{L}+:$/u.test(bare) && keyOf(bare.slice(0, -1))) continue;
    const key = rawKey ? keyOf(rawKey) : undefined;
    const typed = (quoted ?? bare).trim();
    if (key && typed) {
      const value = filterValue(key, typed);
      if (value) add(filters, key, value as never);
      const shown =
        !value || CHOICES[key] ? (value ?? typed) : key === "folder" ? `/${typed.replace(/^\//, "")}` : typed;
      used.push({ token, key, value: shown, known: !!value });
      continue;
    }
    if (quoted !== undefined) {
      if (!typed) continue;
      if (neg) exclude.push(typed);
      else {
        phrases.push(typed);
        text.push(typed);
      }
      continue;
    }
    const word = rawKey ? `${rawKey}:${bare}` : bare;
    if (neg && word.length > 1) exclude.push(word);
    else if (!neg) {
      terms.push(word);
      text.push(word);
    }
  }
  return { raw, terms, phrases, exclude, filters, used, text: text.join(" ") };
}

/** the filter being typed at the end of the query (« label:tra », « review: »), before its space */
export function typing(raw: string): { token: string; key: FilterKey; value: string } | null {
  const m = /(?:^|\s)(-?(\p{L}+):"?([^\s"]*))$/u.exec(raw);
  const key = m && keyOf(m[2]);
  return m && key ? { token: m[1], key, value: m[3] } : null;
}

export const wants = (q: Query, kind: SearchKind) => !q.filters.in?.length || q.filters.in.includes(kind);

// ponytail: a filter only tests can answer (review:, label:, has:…) keeps the search on tests
export const testsOnly = (f: Filters) =>
  !!(
    f.review?.length ||
    f.sync?.length ||
    f.label?.length ||
    f.folder?.length ||
    f.has?.length ||
    f.is?.length ||
    f.assignee?.length
  );
