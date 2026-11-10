import type { LineFix, SpokenLine } from "../../types.ts";

export type Token = { text: string; from: number; to: number; p: number };
export type Word = { text: string; from: number; to: number; p: number };

const LINE_S = 15;
const PAUSE_S = 0.6;
const UNSURE = 0.6;
const NOISE = 0.2;
const ENDS = /[.!?…。？！]["»”')\]]*$/;

// ponytail: Whisper answers in pieces of words (« Dre », « h », « gest », « elle »); a piece that starts with a space
// starts a word, punctuation hangs on the word before it, and its marks ([_BEG_], <|…|>) are not words
export function wordsOf(tokens: Token[]): Word[] {
  const out: Word[] = [];
  for (const t of tokens) {
    if (/^\[_.*\]$|^<\|.*\|>$/.test(t.text.trim()) || !t.text) continue;
    const last = out.at(-1);
    const glued = !/^\s/.test(t.text) && !!last;
    if (glued && last) {
      last.text += t.text;
      last.to = Math.max(last.to, t.to);
      if (/[\p{L}\p{N}]/u.test(t.text)) last.p = Math.min(last.p, t.p);
    } else out.push({ text: t.text.trim(), from: t.from, to: t.to, p: t.p });
  }
  return out.filter((w) => w.text);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ponytail: a line is one sentence at most, so an anchor points within a second or two: cut after the punctuation that
// ends a sentence when the model wrote some (turbo punctuates English, not always French), else on a pause of the
// voice, and at 15 s whatever happens. How sure the line is comes from its words — a weak signal (Whisper invents with
// confidence), enough to say « listen before you trust this one »
export function linesOf(words: Word[], lang?: string): SpokenLine[] {
  const out: SpokenLine[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const p = mean(cur.filter((w) => /[\p{L}\p{N}]/u.test(w.text)).map((w) => w.p));
    const text = cur
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text)
      out.push({
        at: cur[0].from,
        end: Math.max(cur[0].from, cur.at(-1)?.to ?? cur[0].from),
        text,
        ...(lang ? { lang } : {}),
        p: Math.round(p * 100) / 100,
        ...(p < UNSURE ? { unsure: true } : {}),
      });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = cur.at(-1);
    if (prev && (w.from - prev.to >= PAUSE_S || w.to - cur[0].from > LINE_S)) flush();
    cur.push(w);
    if (ENDS.test(w.text) && words[i + 1]) flush();
  });
  flush();
  return out;
}

// ponytail: the sentences Whisper writes when it hears nothing it knows — the subtitle credits of its training videos.
// One of them alone in its passage is an invention; inside real speech it may have been said
const INVENTED: Record<string, string[]> = {
  fr: [
    "sous-titres réalisés par la communauté d'amara.org",
    "sous-titres réalisés para la communauté d'amara.org",
    "sous-titrage société radio-canada",
    "sous-titrage st' 501",
    "merci d'avoir regardé cette vidéo",
    "merci d'avoir regardé cette vidéo !",
    "merci d'avoir regardé",
    "sous-titres par soustitreur.com",
  ],
  en: [
    "thanks for watching",
    "thank you for watching",
    "subtitles by the amara.org community",
    "please subscribe",
    "like and subscribe",
  ],
  de: [
    "untertitel der amara.org-community",
    "untertitel im auftrag des zdf für funk, 2017",
    "untertitelung des zdf, 2020",
    "vielen dank fürs zuschauen",
  ],
  es: ["subtítulos realizados por la comunidad de amara.org", "gracias por ver el video"],
  it: ["sottotitoli creati dalla comunità amara.org", "sottotitoli e revisione a cura di qtss"],
  nl: ["ondertitels ingediend door de amara.org gemeenschap", "ondertiteld door de amara.org gemeenschap"],
  pt: ["legendas pela comunidade amara.org"],
};

const bare = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const isInvented = (text: string): boolean => Object.values(INVENTED).some((list) => list.includes(bare(text)));

// ponytail: what is kept of a passage's lines — an invented sentence alone in its passage goes, a sentence said over
// and over (Whisper looping on a noise) is kept once and marked unsure, and a line whose words are all but random
// (under 0.2) is noise the voice detector let through
export function cleaned(lines: SpokenLine[]): SpokenLine[] {
  if (lines.length && lines.every((l) => isInvented(l.text))) return [];
  const out: SpokenLine[] = [];
  for (const l of lines) {
    if ((l.p ?? 1) < NOISE) continue;
    const last = out.at(-1);
    if (last && bare(last.text) === bare(l.text)) {
      last.end = Math.max(last.end, l.end);
      last.unsure = true;
      continue;
    }
    out.push({ ...l });
  }
  return out;
}

// ponytail: a transcript in the video's own time, one anchor a second — a line that starts in the second another did
// joins it (the anchor of a line is its second, which two lines cannot share), and a line the piece before already
// heard (the 2 s two pieces share where nothing was silent) is dropped by its time
export function assembled(pieces: SpokenLine[][]): SpokenLine[] {
  const out: SpokenLine[] = [];
  for (const piece of pieces) {
    const heard = out.at(-1)?.end ?? -1;
    for (const l of [...piece].sort((a, b) => a.at - b.at)) {
      const last = out.at(-1);
      if (l.at < heard - 0.25) continue;
      if (last && Math.floor(l.at) === Math.floor(last.at)) {
        last.text = `${last.text} ${l.text}`.trim();
        last.end = Math.max(last.end, l.end);
        if (l.unsure) last.unsure = true;
        if (l.p !== undefined && last.p !== undefined) last.p = Math.min(last.p, l.p);
        continue;
      }
      out.push({ ...l });
    }
  }
  return out;
}

// ponytail: a range of time a person corrected or confirmed is theirs — what a machine hears in it is dropped and
// their text stands, on one line at the start of the range, never unsure. No text is ever compared to put a fix back:
// time is what does not move
export function withFixes(lines: SpokenLine[], fixes: LineFix[]): SpokenLine[] {
  if (!fixes.length) return lines;
  const owned = (l: SpokenLine) => fixes.some((f) => l.at >= f.from - 0.01 && l.at < f.to - 0.01);
  const kept = lines.filter((l) => !owned(l));
  const human: SpokenLine[] = fixes
    .filter((f) => f.text.trim())
    .map((f) => {
      const was = lines.find((l) => l.at >= f.from - 0.01 && l.at < f.to - 0.01);
      return {
        at: f.from,
        end: f.to,
        text: f.text.replace(/\s+/g, " ").trim(),
        ...(was?.lang ? { lang: was.lang } : {}),
        by: "human" as const,
      };
    });
  return [...kept, ...human].sort((a, b) => a.at - b.at);
}

// ponytail: what was said, without what the model chose to write around it — case and punctuation are the model's,
// not the speaker's (turbo punctuates one recording and not the next). A quote of speech is compared word for word on
// this form, so a comma never breaks a source; nothing else is loosened
export const spoken = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// ponytail: an anchor is a second, so no two lines may start in the same one — the later joins the earlier; a line a
// person wrote keeps its mark
export function bySecond(lines: SpokenLine[]): SpokenLine[] {
  const out: SpokenLine[] = [];
  for (const l of [...lines].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (!last || Math.floor(l.at) !== Math.floor(last.at)) {
      out.push({ ...l });
      continue;
    }
    last.text = `${last.text} ${l.text}`.trim();
    last.end = Math.max(last.end, l.end);
    if (l.by === "human") last.by = "human";
    if (l.unsure && last.by !== "human") last.unsure = true;
    if (last.by === "human") delete last.unsure;
    if (l.translation) last.translation = `${last.translation ?? ""} ${l.translation}`.trim();
  }
  return out;
}
