export type Voice = { from: number; to: number };
export type Silence = { from: number; to: number };

export const PASSAGE_S = 10;
export const WINDOW_S = 28;
const JOIN_GAP_S = 1;
const PAD_S = 0.2;
export const PIECE_S = 600;
const PIECE_SLACK_S = 90;
export const OVERLAP_S = 2;

// ponytail: the voice detector gives stretches of speech; those close together (< 1 s apart) are one passage of about
// 10 s — long enough for Whisper to tell its language, short enough that a change of language falls between two
// passages. A stretch longer than that (the detector cuts at 15 s) is a passage of its own.
// Whisper works on a window of 30 s whatever it is given, and telling the language costs it a second pass: measured
// on this PC (2026-11-10), a passage costs 0.3 s on an NVIDIA card and 12 s on 8 processor threads, 10 s long or 3.
// So on a processor the passages are as long as the window allows (28 s): a language is then told every half-minute
// of speech rather than every 10 s — the price of hearing a video faster than it plays without a card
export function passagesOf(voices: Voice[], maxS = PASSAGE_S): Voice[] {
  const out: Voice[] = [];
  for (const v of [...voices].sort((a, b) => a.from - b.from)) {
    if (v.to <= v.from) continue;
    const last = out.at(-1);
    if (last && v.from - last.to < JOIN_GAP_S && v.to - last.from <= maxS) last.to = v.to;
    else out.push({ from: v.from, to: v.to });
  }
  return out;
}

// ponytail: a passage is heard with a fifth of a second around it, never into its neighbour
export function padded(p: Voice, i: number, all: Voice[], length: number): Voice {
  const before = all[i - 1]?.to ?? 0;
  const after = all[i + 1]?.from ?? length;
  return {
    from: Math.max(0, before, p.from - PAD_S),
    to: Math.min(length, Math.max(p.to, Math.min(after, p.to + PAD_S))),
  };
}

export type Piece = { k: number; from: number; to: number; overlap: number };

// ponytail: the sound is worked in pieces of about ten minutes, each saved as it is transcribed, so a conversion cut
// short goes on at the next piece. A piece ends in the middle of a silence ffmpeg heard (≥ 0.5 s) near the ten-minute
// mark, so no sentence is cut; where nothing is silent (a cabin's noise) it is cut anyway and the next piece starts
// 2 s earlier — the lines heard twice are dropped by their time
export function piecesOf(duration: number, silences: Silence[], from = 0, to = duration): Piece[] {
  const end = Math.min(duration, to);
  const out: Piece[] = [];
  let at = Math.max(0, from);
  let overlap = 0;
  while (end - at > PIECE_S + PIECE_SLACK_S) {
    const want = at + PIECE_S;
    const quiet = silences
      .map((s) => (s.from + s.to) / 2)
      .filter((m) => Math.abs(m - want) <= PIECE_SLACK_S)
      .sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    const cut = quiet ?? want;
    out.push({ k: out.length + 1, from: at, to: cut, overlap });
    overlap = quiet === undefined ? OVERLAP_S : 0;
    at = cut - overlap;
  }
  out.push({ k: out.length + 1, from: at, to: Math.max(at, end), overlap });
  return out;
}

export type Detected = { language: string; p: number; probabilities: Record<string, number> };

export const SURE = 0.6;

// ponytail: the language a passage is transcribed in. Whisper detects it on the passage itself — never on the whole
// video, whose first 30 s decide wrongly three times out of five (measured). Forcing a language makes Whisper
// translate in silence what was said in another, so a passage keeps what was detected unless that is doubtful: under
// 0.6 it takes its neighbour's language (a 2-second curse was heard as English at 0.37), and a language outside those
// expected (Welsh on a cabin's noise) becomes the most probable of them
export function languageFor(
  detected: Detected,
  o: { expected: string[]; neighbour?: string },
): { language: string; again: boolean } {
  const expected = o.expected.map((l) => l.toLowerCase());
  const best = (among: string[]) =>
    [...among].sort((a, b) => (detected.probabilities[b] ?? 0) - (detected.probabilities[a] ?? 0))[0];
  const allowed = (l: string | undefined): l is string => !!l && (!expected.length || expected.includes(l));
  let language = detected.language;
  if (!allowed(language)) language = allowed(o.neighbour) ? o.neighbour : best(expected);
  else if (detected.p < SURE) {
    if (allowed(o.neighbour)) language = o.neighbour;
    else if (expected.length) language = best(expected);
  }
  return { language, again: language !== detected.language };
}

// ponytail: Whisper names a language in full in some answers (« german ») and by its code in others (« de »)
const NAMES: Record<string, string> = {
  english: "en",
  french: "fr",
  german: "de",
  spanish: "es",
  italian: "it",
  dutch: "nl",
  portuguese: "pt",
  russian: "ru",
  chinese: "zh",
  japanese: "ja",
  arabic: "ar",
  polish: "pl",
  turkish: "tr",
  swedish: "sv",
  danish: "da",
  norwegian: "no",
  finnish: "fi",
  czech: "cs",
  greek: "el",
  hungarian: "hu",
  romanian: "ro",
  ukrainian: "uk",
  korean: "ko",
  hindi: "hi",
  hebrew: "he",
  catalan: "ca",
};

export const languageCode = (name: string): string => {
  const n = name.trim().toLowerCase();
  return NAMES[n] ?? n;
};

export const SPOKEN_LANGUAGES: { code: string; name: string; quality: "best" | "good" }[] = [
  { code: "en", name: "English", quality: "best" },
  { code: "fr", name: "French", quality: "best" },
  { code: "de", name: "German", quality: "best" },
  { code: "es", name: "Spanish", quality: "best" },
  { code: "it", name: "Italian", quality: "best" },
  { code: "nl", name: "Dutch", quality: "best" },
  { code: "pt", name: "Portuguese", quality: "best" },
  { code: "pl", name: "Polish", quality: "good" },
  { code: "sv", name: "Swedish", quality: "good" },
  { code: "da", name: "Danish", quality: "good" },
  { code: "no", name: "Norwegian", quality: "good" },
  { code: "fi", name: "Finnish", quality: "good" },
  { code: "cs", name: "Czech", quality: "good" },
  { code: "ro", name: "Romanian", quality: "good" },
  { code: "hu", name: "Hungarian", quality: "good" },
  { code: "el", name: "Greek", quality: "good" },
  { code: "tr", name: "Turkish", quality: "good" },
  { code: "ru", name: "Russian", quality: "good" },
  { code: "uk", name: "Ukrainian", quality: "good" },
  { code: "ar", name: "Arabic (standard)", quality: "good" },
  { code: "zh", name: "Chinese", quality: "good" },
  { code: "ja", name: "Japanese", quality: "good" },
  { code: "ko", name: "Korean", quality: "good" },
  { code: "hi", name: "Hindi", quality: "good" },
];

export const spokenName = (code: string): string =>
  SPOKEN_LANGUAGES.find((l) => l.code === code.toLowerCase())?.name ?? code;
