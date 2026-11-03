// ponytail: a port of the Snowball French stemmer (snowballstem.org/algorithms/french, BSD) — french.sbl, master of
// 2026-11; checked word for word against snowball-data/french in tests/unit/stem-fr.test.ts
export const STEM_VERSION = 1;

const VOWELS = "aeiouyâàëéêèïîôûù";
const v = (c: string | undefined): boolean => c !== undefined && c.length === 1 && VOWELS.includes(c);

const STANDARD: string[][] = [
  ["ance", "iqUe", "isme", "able", "iste", "eux", "ances", "iqUes", "ismes", "ables", "istes"],
  ["atrice", "ateur", "ation", "atrices", "ateurs", "ations"],
  ["logie", "logies"],
  ["usion", "ution", "usions", "utions"],
  ["ence", "ences"],
  ["ement", "ements"],
  ["ité", "ités"],
  ["if", "ive", "ifs", "ives"],
  ["eaux"],
  ["aux"],
  ["oux"],
  ["euse", "euses"],
  ["issement", "issements"],
  ["amment"],
  ["emment"],
  ["ment", "ments"],
];
const STANDARD_GROUP = new Map(STANDARD.flatMap((g, i) => g.map((s): [string, number] => [s, i])));
const STANDARD_ALL = [...STANDARD_GROUP.keys()];

const I_VERB = [
  "îmes",
  "ît",
  "îtes",
  "i",
  "ie",
  "ies",
  "ir",
  "ira",
  "irai",
  "iraIent",
  "irais",
  "irait",
  "iras",
  "irent",
  "irez",
  "iriez",
  "irions",
  "irons",
  "iront",
  "is",
  "issaIent",
  "issais",
  "issait",
  "issant",
  "issante",
  "issantes",
  "issants",
  "isse",
  "issent",
  "isses",
  "issez",
  "issiez",
  "issions",
  "issons",
  "it",
];

const VERB: string[][] = [
  ["ions"],
  [
    "é",
    "ée",
    "ées",
    "és",
    "èrent",
    "er",
    "era",
    "erai",
    "eraIent",
    "erais",
    "erait",
    "eras",
    "erez",
    "eriez",
    "erions",
    "erons",
    "eront",
    "ez",
    "iez",
  ],
  [
    "âmes",
    "ât",
    "âtes",
    "a",
    "ai",
    "aIent",
    "ait",
    "ant",
    "ante",
    "antes",
    "ants",
    "as",
    "asse",
    "assent",
    "asses",
    "assiez",
    "assions",
  ],
  ["ais", "aise", "aises"],
  ["eais"],
];
const VERB_GROUP = new Map(VERB.flatMap((g, i) => g.map((s): [string, number] => [s, i])));
const VERB_ALL = [...VERB_GROUP.keys()];

const RESIDUAL = ["ion", "ier", "ière", "Ier", "Ière", "e"];

function longest(s: string, list: readonly string[], lb: number): string | undefined {
  let best: string | undefined;
  for (const x of list) if ((!best || x.length > best.length) && s.length - x.length >= lb && s.endsWith(x)) best = x;
  return best;
}

function preludeAt(s: string, i: number): string | null {
  const c = s[i];
  const n = s[i + 1];
  const put = (from: number, to: number, by: string) => s.slice(0, from) + by + s.slice(to);
  if (v(c)) {
    if (n === "u" && v(s[i + 2])) return put(i + 1, i + 2, "U");
    if (n === "i" && v(s[i + 2])) return put(i + 1, i + 2, "I");
    if (n === "y") return put(i + 1, i + 2, "Y");
  }
  if (c === "ë") return put(i, i + 1, "He");
  if (c === "ï") return put(i, i + 1, "Hi");
  if (c === "y" && v(n)) return put(i, i + 1, "Y");
  if (c === "q" && n === "u") return put(i + 1, i + 2, "U");
  return null;
}

function prelude(word: string): string {
  let s = word;
  let i = 0;
  while (i < s.length) {
    const r = preludeAt(s, i);
    if (r === null) i++;
    else s = r;
  }
  return s;
}

function pastVowelThenConsonant(s: string, from: number): number | null {
  let i = from;
  while (i < s.length && !v(s[i])) i++;
  if (i >= s.length) return null;
  i++;
  while (i < s.length && v(s[i])) i++;
  return i >= s.length ? null : i + 1;
}

function regions(s: string): { pV: number; p1: number; p2: number } {
  const l = s.length;
  let pV = l;
  if (v(s[0]) && v(s[1]) && l >= 3) pV = 3;
  else if (s.startsWith("par") || s.startsWith("col") || s.startsWith("tap")) pV = 3;
  else if (s.startsWith("ni") && v(s[2])) pV = 3;
  else
    for (let i = 1; i < l; i++)
      if (v(s[i])) {
        pV = i + 1;
        break;
      }
  const p1 = pastVowelThenConsonant(s, 0);
  const p2 = p1 === null ? null : pastVowelThenConsonant(s, p1);
  return { pV, p1: p1 ?? l, p2: p2 ?? l };
}

function postlude(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "H") {
      if (s[i + 1] === "e") {
        out += "ë";
        i++;
      } else if (s[i + 1] === "i") {
        out += "ï";
        i++;
      }
    } else if (c === "I" || c === "U" || c === "Y") out += c.toLowerCase();
    else out += c;
  }
  return out;
}

function stemUncached(word: string): string {
  let s = word.toLowerCase();
  const elision = /^(?:[cdjlmnstz]|qu)'/.exec(s);
  if (elision && s.length > elision[0].length) s = s.slice(elision[0].length);
  s = prelude(s);
  const { pV, p1, p2 } = regions(s);
  const cut = (n: number, by = "") => {
    s = s.slice(0, s.length - n) + by;
  };
  const start = (suffix: string) => s.length - suffix.length;

  const standard = (): boolean => {
    const m = longest(s, STANDARD_ALL, 0);
    if (!m) return false;
    const st = start(m);
    switch (STANDARD_GROUP.get(m)) {
      case 0:
        if (st < p2) return false;
        cut(m.length);
        return true;
      case 1:
        if (st < p2) return false;
        cut(m.length);
        if (s.endsWith("ic")) cut(2, start("ic") >= p2 ? "" : "iqU");
        return true;
      case 2:
        if (st < p2) return false;
        cut(m.length, "log");
        return true;
      case 3:
        if (st < p2) return false;
        cut(m.length, "u");
        return true;
      case 4:
        if (st < p2) return false;
        cut(m.length, "ent");
        return true;
      case 5: {
        if (st < pV) return false;
        cut(m.length);
        const m2 = longest(s, ["iv", "eus", "abl", "iqU", "ièr", "Ièr"], 0);
        if (!m2) return true;
        const st2 = start(m2);
        if (m2 === "iv") {
          if (st2 >= p2) {
            cut(2);
            if (s.endsWith("at") && start("at") >= p2) cut(2);
          }
        } else if (m2 === "eus") {
          if (st2 >= p2) cut(3);
          else if (st2 >= p1) cut(3, "eux");
        } else if (m2 === "abl" || m2 === "iqU") {
          if (st2 >= p2) cut(3);
        } else if (st2 >= pV) cut(3, "i");
        return true;
      }
      case 6: {
        if (st < p2) return false;
        cut(m.length);
        const m2 = longest(s, ["abil", "ic", "iv"], 0);
        if (!m2) return true;
        const r2 = start(m2) >= p2;
        if (m2 === "abil") cut(4, r2 ? "" : "abl");
        else if (m2 === "ic") cut(2, r2 ? "" : "iqU");
        else if (r2) cut(2);
        return true;
      }
      case 7:
        if (st < p2) return false;
        cut(m.length);
        if (s.endsWith("at") && start("at") >= p2) {
          cut(2);
          if (s.endsWith("ic")) cut(2, start("ic") >= p2 ? "" : "iqU");
        }
        return true;
      case 8:
        cut(4, "eau");
        return true;
      case 9:
        if (st < p1) return false;
        cut(3, "al");
        return true;
      case 10:
        if (st < 1 || !"bhjlnp".includes(s[st - 1])) return false;
        cut(3, "ou");
        return true;
      case 11:
        if (st >= p2) cut(m.length);
        else if (st >= p1) cut(m.length, "eux");
        else return false;
        return true;
      case 12:
        if (st < p1 || st < 1 || v(s[st - 1])) return false;
        cut(m.length);
        return true;
      case 13:
        if (st >= pV) cut(m.length, "ant");
        return false;
      case 14:
        if (st >= pV) cut(m.length, "ent");
        return false;
      default:
        if (st >= 1 && v(s[st - 1]) && st - 1 >= pV) cut(m.length);
        return false;
    }
  };

  const iVerb = (): boolean => {
    if (pV > s.length) return false;
    const m = longest(s, I_VERB, pV);
    if (!m) return false;
    const st = start(m);
    if (st - 1 < pV || s[st - 1] === "H" || v(s[st - 1])) return false;
    cut(m.length);
    return true;
  };

  const verb = (): boolean => {
    if (pV > s.length) return false;
    const m = longest(s, VERB_ALL, pV);
    if (!m) return false;
    const st = start(m);
    switch (VERB_GROUP.get(m)) {
      case 0:
        if (st < p2) return false;
        cut(m.length);
        return true;
      case 2:
        cut(st >= 1 && s[st - 1] === "e" && st - 1 >= pV ? m.length + 1 : m.length);
        return true;
      case 3: {
        const before = s.slice(0, st);
        const blocked =
          before.endsWith("auv") || before.endsWith("épl") || (before.endsWith("al") && before.length === 3);
        if (blocked) return false;
        cut(m.length);
        return true;
      }
      default:
        cut(m.length);
        return true;
    }
  };

  const residual = () => {
    if (s.endsWith("s")) {
      const st = s.length - 1;
      if (s.slice(0, st).endsWith("Hi") || (st >= 1 && !"aiouès".includes(s[st - 1]))) cut(1);
    }
    if (pV > s.length) return;
    const m = longest(s, RESIDUAL, pV);
    if (!m) return;
    const st = start(m);
    if (m === "ion") {
      if (st >= p2 && st - 1 >= pV && (s[st - 1] === "s" || s[st - 1] === "t")) cut(3);
    } else if (m === "e") cut(1);
    else cut(m.length, "i");
  };

  if (standard() || iVerb() || verb()) {
    if (s.endsWith("Y")) cut(1, "i");
    else if (s.endsWith("ç")) cut(1, "c");
  } else residual();

  if (["enn", "onn", "ett", "ell", "eill"].some((x) => s.endsWith(x))) cut(1);

  let i = s.length;
  while (i > 0 && !v(s[i - 1])) i--;
  if (i < s.length && (s[i - 1] === "é" || s[i - 1] === "è")) s = `${s.slice(0, i - 1)}e${s.slice(i)}`;

  return postlude(s);
}

const cache = new Map<string, string>();

export function stemWord(word: string): string {
  let r = cache.get(word);
  if (r === undefined) {
    if (cache.size > 50_000) cache.clear();
    r = stemUncached(word);
    cache.set(word, r);
  }
  return r;
}

const ELIDED: Record<string, string> = {
  c: "ce",
  d: "de",
  j: "je",
  l: "le",
  m: "me",
  n: "ne",
  s: "se",
  t: "te",
  qu: "que",
};

export function frenchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(?<![\p{L}\p{N}])(qu|[cdjlmnst])['’](?=\p{L})/gu, (_, e: string) => `${ELIDED[e]} `)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function stemText(text: string): string {
  return frenchTokens(text).map(stemWord).join(" ");
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// ponytail: folded one character at a time, so an offset in the folded text is the same offset in the text — the
// marks found on one land on the other
export function foldKeep(text: string): string {
  let out = "";
  for (const c of text) {
    const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === c.length ? f : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return out;
}

// ponytail: articles and prepositions only (SPEC-RAG §4.2) — negation and restriction words (ne, pas, sauf, excepté,
// uniquement, seulement, interdit, jamais, sans) and meaningful prepositions (sous, hors, avant, après) stay searchable
export const STOP_WORDS: ReadonlySet<string> = new Set(
  "le la les l un une des du de d au aux a en dans par pour sur avec chez vers entre parmi selon via the an of to in on for by with".split(
    " ",
  ),
);
