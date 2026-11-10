import { spoken } from "./lines.ts";

const SMALL = new Map<string, number>(
  Object.entries({
    zero: 0,
    zéro: 0,
    null: 0,
    one: 1,
    un: 1,
    une: 1,
    ein: 1,
    eins: 1,
    eine: 1,
    two: 2,
    deux: 2,
    zwei: 2,
    zwo: 2,
    three: 3,
    trois: 3,
    drei: 3,
    four: 4,
    quatre: 4,
    vier: 4,
    five: 5,
    cinq: 5,
    fünf: 5,
    six: 6,
    sechs: 6,
    seven: 7,
    sept: 7,
    sieben: 7,
    eight: 8,
    huit: 8,
    acht: 8,
    nine: 9,
    neuf: 9,
    neun: 9,
    ten: 10,
    dix: 10,
    zehn: 10,
    eleven: 11,
    onze: 11,
    elf: 11,
    twelve: 12,
    douze: 12,
    zwölf: 12,
    thirteen: 13,
    treize: 13,
    dreizehn: 13,
    fourteen: 14,
    quatorze: 14,
    vierzehn: 14,
    fifteen: 15,
    quinze: 15,
    fünfzehn: 15,
    sixteen: 16,
    seize: 16,
    sechzehn: 16,
    seventeen: 17,
    siebzehn: 17,
    eighteen: 18,
    achtzehn: 18,
    nineteen: 19,
    neunzehn: 19,
  }),
);
const TENS = new Map<string, number>(
  Object.entries({
    twenty: 20,
    vingt: 20,
    vingts: 20,
    zwanzig: 20,
    thirty: 30,
    trente: 30,
    dreißig: 30,
    dreissig: 30,
    forty: 40,
    quarante: 40,
    vierzig: 40,
    fifty: 50,
    cinquante: 50,
    fünfzig: 50,
    sixty: 60,
    soixante: 60,
    sechzig: 60,
    seventy: 70,
    septante: 70,
    siebzig: 70,
    eighty: 80,
    huitante: 80,
    octante: 80,
    achtzig: 80,
    ninety: 90,
    nonante: 90,
    neunzig: 90,
  }),
);
const HUNDRED = new Set(["hundred", "cent", "cents", "hundert"]);
const THOUSAND = new Set(["thousand", "mille", "tausend"]);
const PERCENT = new Set(["pourcent", "pourcents", "prozent"]);
const BETWEEN = new Set(["of", "sur", "von", "point", "virgule", "komma"]);
const GERMAN =
  "tausend|hundert|und|zwanzig|dreißig|dreissig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zehn|elf|zwölf|eins|eine|ein|zwei|zwo|drei|vier|fünf|sechs|sieben|acht|neun";
const COMPOUND = new RegExp(`^(?:${GERMAN})+$`);
const PART = new RegExp(GERMAN, "g");
const isNumber = (t: string | undefined) => !!t && /^\d+$/.test(t);

type Open = {
  total: number;
  group: number;
  last: "unit" | "teen" | "tens" | "hundred" | "thousand" | "und";
  french: boolean;
  dix: boolean;
};

// ponytail: the words two transcripts are compared on — beyond case and punctuation (lines.ts spoken), a number reads
// the same however it was written: « two hundred and three », « deux cent trois », « zweihundertdrei » and « 203 »
// are 203, « S12 » and « S 12 » are « s 12 », « 1 / 8 », « one of eight » and « 1 8 » are 18, « 80 % » is « 80 percent ».
// One lexicon for French, English and German together: a video changes language from one passage to the next, and
// both sides go through the same reading, so a word taken for a number (« un », « one », « neuf ») is taken so on
// both. Only the word error rate is counted on this form — a quote and a term of the glossary stay what was written
export function comparable(text: string): string[] {
  const tokens = spoken(text.replace(/%/g, " percent "))
    .split(" ")
    .flatMap((t) => t.match(/\p{L}+|\p{N}+/gu) ?? [])
    .flatMap((t) => (COMPOUND.test(t) ? (t.match(PART) ?? [t]) : [t]));
  const out: string[] = [];
  let n: Open | null = null;
  const flush = () => {
    if (n) out.push(String(n.total + n.group));
    n = null;
  };
  const open = (group: number, total = 0): Open => {
    flush();
    return { total, group, last: "unit", french: false, dix: false };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    const small = SMALL.get(t);
    const tens = TENS.get(t);
    if (small !== undefined) {
      const o: Open | null = n;
      if (o && (o.last === "hundred" || o.last === "thousand")) o.group += small;
      else if (o && o.last === "tens" && (small < 10 || o.french)) o.group += small;
      else if (o?.dix && small >= 7 && small <= 9) o.group += small;
      else n = open(small);
      const now = n as Open;
      now.last = small < 10 ? "unit" : "teen";
      now.dix = t === "dix";
      now.french = false;
    } else if (tens !== undefined) {
      const o: Open | null = n;
      const eighty = !!o && tens === 20 && tokens[i - 1] === "quatre" && o.last === "unit" && o.group % 100 === 4;
      const joins = !!o && o.last === "und";
      if (o && eighty) o.group += 76;
      else if (o && (joins || o.last === "hundred" || o.last === "thousand")) o.group += tens;
      else n = open(tens);
      const now = n as Open;
      now.last = joins ? "teen" : "tens";
      now.french = eighty || t === "soixante";
      now.dix = false;
    } else if (HUNDRED.has(t)) {
      const o: Open | null = n;
      if (o && (o.last === "unit" || o.last === "teen") && o.group > 0 && o.group < 20) o.group *= 100;
      else if (o && o.last === "thousand") o.group = 100;
      else n = open(100);
      const now = n as Open;
      now.last = "hundred";
      now.dix = false;
    } else if (THOUSAND.has(t)) {
      const o: Open | null = n;
      if (o && o.last !== "thousand" && !o.total && o.group > 0) {
        o.total = o.group * 1000;
        o.group = 0;
      } else n = open(0, 1000);
      const now = n as Open;
      now.last = "thousand";
      now.dix = false;
    } else if (/^\p{N}+$/u.test(t)) {
      flush();
      out.push(t);
    } else {
      const o: Open | null = n;
      const more = SMALL.has(next) || TENS.has(next);
      if (o && t === "and" && (o.last === "hundred" || o.last === "thousand") && more) continue;
      if (o && t === "et" && o.last === "tens" && (next === "un" || next === "une" || next === "onze")) continue;
      if (o && t === "und" && o.last === "unit" && o.group % 100 < 10 && TENS.has(next)) {
        o.last = "und";
        continue;
      }
      flush();
      if ((t === "pour" || t === "per") && next === "cent") {
        out.push("percent");
        i++;
      } else out.push(PERCENT.has(t) ? "percent" : t);
    }
  }
  flush();
  const joined: string[] = [];
  for (const [i, t] of out.entries()) {
    const last = joined.at(-1);
    if (BETWEEN.has(t) && isNumber(last) && isNumber(out[i + 1])) continue;
    if (isNumber(t) && isNumber(last)) joined[joined.length - 1] = `${last}${t}`;
    else joined.push(t);
  }
  return joined;
}
