import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { semaphore } from "../../../shared/run/work.ts";
import { type Ctx, UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { clock } from "../../rag/anchors.ts";
import type { MediaFile, SpokenLine, TranscriptMade } from "../../types.ts";
import { recordPerf } from "../models-perf.ts";
import { readJson, writeJson } from "../project.ts";
import { type SpeechSetup, speechSpeed } from "./engine.ts";
import { promptFor } from "./glossary.ts";
import { cancelled, type Listener, type Sound, STALLED, videoIo } from "./io.ts";
import { assembled, cleaned, linesOf, wordsOf } from "./lines.ts";
import { languageFor, PASSAGE_S, type Piece, padded, passagesOf, piecesOf, SURE, WINDOW_S } from "./passages.ts";
import { readWav, slice, sliceTo, type Wav } from "./wav.ts";

// ponytail: a transcription takes the whole processor or the card — one at a time on this PC, whatever the conversion
// slots allow; the others wait their turn and say so
const oneAtATime = semaphore(1);
let busy = 0;

export type SpeechInput = {
  src: string;
  dir: string;
  file: MediaFile;
  duration: number;
  tracks: number;
  spoken: string[];
  glossary: { prompt: string; hash: string };
  setup: SpeechSetup;
  force?: boolean;
  onPiece?: (lines: SpokenLine[], done: number, total: number) => void;
};
export type SpeechResult = {
  lines: SpokenLine[];
  languages: Record<string, number>;
  made: TranscriptMade;
  device: "gpu" | "cpu";
  tookMs: number;
  pieces: number;
  fresh: number;
};

type SoundFile = { key: string; duration: number; silences: Sound["silences"] };
type PieceFile = {
  made: TranscriptMade;
  from: number;
  to: number;
  lines: SpokenLine[];
  languages: Record<string, number>;
};

// ponytail: a piece is the same when the same model, engine, languages and glossary heard the same sound — the track
// (none: all, mixed) and the second the sound drawn starts at, which with the piece's own from and to is its place in
// the video. A piece written before these two were kept was heard whole with all tracks: it reads as such
const sameMade = (a: TranscriptMade, b: TranscriptMade) =>
  a.model === b.model &&
  a.engine === b.engine &&
  a.glossary === b.glossary &&
  a.spoken.join() === b.spoken.join() &&
  (a.track ?? null) === (b.track ?? null) &&
  (a.from ?? 0) === (b.from ?? 0);

const hundredth = (s: number) => Math.round(s * 100) / 100;

const left = (seconds: number) => (seconds < 90 ? "about a minute left" : `about ${Math.round(seconds / 60)} min left`);

const OWN_AFTER_MS = 3000;
const OWN_ALONE_MS = 60_000;

// ponytail: the time left is told from the speed this PC's last transcriptions measured for the model on this device
// (the journal of timings), so it is there from the first second; it moves to this run's own speed over its first
// minute of work. A PC that never transcribed has no journal: the run's own speed, once it has worked 3 s
export function paceOf(journal: number | null, coveredS: number, spentMs: number): number | null {
  const own = spentMs > OWN_AFTER_MS && coveredS > 0 ? coveredS / (spentMs / 1000) : null;
  if (!journal) return own;
  if (!own) return journal;
  const mine = Math.min(1, spentMs / OWN_ALONE_MS);
  return journal * (1 - mine) + own * mine;
}

const isStalled = (e: unknown) => e instanceof UserError && e.code === STALLED;

// ponytail: what is said in a video, on this PC. The sound is drawn once to a WAV on disk; it is worked in pieces of
// about ten minutes, each kept under transcript/<k>.json with what made it (model, engine, languages, glossary, sound
// track, where the sound starts), so a conversion cut short goes on at the next piece and changing the glossary or the
// track redoes the pieces, nothing else. In a piece the voice detector finds the speech (silence, music and cabin
// noise are never given to the model, which invents on them), the speech is grouped into passages of about 10 s, and
// each passage is transcribed in its own language with the glossary and the end of the passage before it. A piece
// that ran into a time limit is tried once more, with an engine started anew, before the conversion says so
export async function transcribe(ctx: Ctx, o: SpeechInput): Promise<SpeechResult> {
  const name = o.file.name;
  const store = join(o.dir, "transcript");
  const wavFile = join(o.dir, "sound.wav");
  const soundFile = join(o.dir, "sound.json");
  const offset = Math.min(o.duration, o.file.range?.from ?? 0);
  const until = Math.min(o.duration, o.file.range?.to ?? o.duration);
  const made: TranscriptMade = {
    model: o.setup.entry.id,
    engine: o.setup.engine,
    spoken: o.spoken,
    glossary: o.glossary.hash,
    ...(o.tracks > 1 && o.file.track !== undefined && o.file.track < o.tracks ? { track: o.file.track } : {}),
    ...(offset > 0 ? { from: offset } : {}),
  };
  const device = o.setup.gpu ? ("gpu" as const) : ("cpu" as const);
  const known = speechSpeed(o.setup.entry, device, o.setup.threads);
  const key = JSON.stringify([o.file.sha256, o.file.track ?? null, o.file.range ?? null]);
  if (o.force) rmSync(store, { recursive: true, force: true });
  mkdirSync(store, { recursive: true });
  if (busy) ctx.progress({ message: `${name}: waiting for the transcription under way` });
  busy++;
  return oneAtATime(async () => {
    const t0 = Date.now();
    let sound = readJson<SoundFile | null>(soundFile, null);
    const pieceFile = (k: number) => join(store, `${k}.json`);
    const kept = (p: Piece): PieceFile | null => {
      const f = readJson<PieceFile | null>(pieceFile(p.k), null);
      return f && sameMade(f.made, made) && f.from === p.from && f.to === p.to ? f : null;
    };
    let pieces = sound?.key === key ? piecesOf(sound.duration, sound.silences) : null;
    if (!pieces || (pieces.some((p) => !kept(p)) && !existsSync(wavFile))) {
      ctx.progress({ message: `Drawing the sound of ${name}`, done: 0, total: 100 });
      const span = until - offset;
      const got = await videoIo.sound(
        o.src,
        wavFile,
        {
          tracks: o.tracks,
          track: o.file.track,
          ...(offset > 0 ? { from: offset } : {}),
          ...(until < o.duration ? { to: until } : {}),
          duration: o.duration,
        },
        (s) =>
          ctx.progress({
            message: `Drawing the sound of ${name}`,
            done: Math.min(100, Math.round((s / Math.max(1, span)) * 100)),
            total: 100,
          }),
        ctx.signal,
      );
      sound = { key, duration: got.duration, silences: got.silences };
      writeJson(soundFile, sound);
      pieces = piecesOf(sound.duration, sound.silences);
    }
    const total = sound?.duration ?? 0;
    const done: PieceFile[] = [];
    let listener = null as Listener | null;
    let wav = null as Wav | null;
    let coveredS = 0;
    let workMs = 0;
    let fresh = 0;
    let loadMs = 0;
    let warming = true;
    const before = new Map<string, string>();
    let neighbour: string | undefined;
    const say = (p: Piece, at: number, sinceMs = 0) => {
      const speed = paceOf(known.measured ? known.speed : null, coveredS + (at - p.from), workMs + sinceMs);
      const rest = speed ? left((total - at) / speed) : "";
      ctx.progress({
        message: `Transcribing ${name} · ${p.k} of ${pieces?.length ?? 1}${rest ? ` · ${rest}` : ""}`,
        done: Math.round(at),
        total: Math.round(total),
      });
    };
    const hearPiece = async (p: Piece, t1: number) => {
      wav ??= readWav(wavFile);
      const cut = join(o.dir, "piece.wav");
      sliceTo(wavFile, wav, p.from, p.to, cut);
      const voices = await videoIo.voices(cut, ctx.signal, p.to - p.from);
      rmSync(cut, { force: true });
      const passages = passagesOf(voices, o.setup.gpu ? PASSAGE_S : WINDOW_S);
      const lines: SpokenLine[] = [];
      const languages: Record<string, number> = {};
      for (const [i, passage] of passages.entries()) {
        if (ctx.signal.aborted) throw cancelled();
        const span = padded(passage, i, passages, p.to - p.from);
        if (span.to - span.from < 0.3) continue;
        if (!listener) {
          const loading = Date.now();
          ctx.progress({ message: `Loading ${o.setup.entry.label} for ${name}` });
          listener = await videoIo.listener(
            { model: o.setup.model, gpu: o.setup.gpu, threads: o.setup.threads, speed: known.speed },
            ctx.signal,
          );
          loadMs += Date.now() - loading;
        }
        const sample = slice(wavFile, wav, p.from + span.from, p.from + span.to);
        const only = o.spoken.length === 1 ? o.spoken[0] : undefined;
        const guess = only ?? neighbour;
        const first = Date.now();
        let heard = await listener.hear(
          sample,
          { language: only, prompt: promptFor(o.glossary.prompt, guess ? before.get(guess) : undefined) },
          ctx.signal,
        );
        // ponytail: the first passage a card hears pays for its kernels (some 30 s the first time, then cached by
        // the driver) — it is counted with the load, never in the speed this PC is said to hear at
        if (warming) loadMs += Date.now() - first;
        warming = false;
        let language = heard.detected.language;
        if (!only) {
          const pick = languageFor(heard.detected, { expected: o.spoken, neighbour });
          language = pick.language;
          if (!pick.again && heard.detected.p >= SURE) neighbour = language;
          if (pick.again || (language !== guess && before.get(language)))
            heard = await listener.hear(
              sample,
              { language, prompt: promptFor(o.glossary.prompt, before.get(language)) },
              ctx.signal,
            );
        }
        const at = offset + p.from + span.from;
        const said = cleaned(
          linesOf(
            wordsOf(heard.tokens).map((w) => ({ ...w, from: hundredth(at + w.from), to: hundredth(at + w.to) })),
            language,
          ),
        );
        if (said.length) {
          lines.push(...said);
          languages[language] = (languages[language] ?? 0) + (span.to - span.from);
          before.set(language, said.map((l) => l.text).join(" "));
        }
        say(p, p.from + span.to, Date.now() - t1 - loadMs);
      }
      return { lines, languages };
    };
    try {
      for (const p of pieces) {
        if (ctx.signal.aborted) throw cancelled();
        const have = kept(p);
        if (have) {
          done.push(have);
          continue;
        }
        say(p, p.from);
        let t1 = Date.now();
        const { lines, languages } = await hearPiece(p, t1).catch(async (e) => {
          if (ctx.signal.aborted || !isStalled(e)) throw e;
          ctx.log(
            "warn",
            `${name}: ${e instanceof Error ? e.message : e} ${clock(offset + p.from)} – ${clock(offset + p.to)} is tried once more.`,
          );
          await listener?.stop().catch(() => {});
          listener = null;
          warming = true;
          loadMs = 0;
          t1 = Date.now();
          return hearPiece(p, t1);
        });
        workMs += Date.now() - t1 - loadMs;
        loadMs = 0;
        coveredS += p.to - p.from;
        const file: PieceFile = { made, from: p.from, to: p.to, lines, languages };
        writeJson(pieceFile(p.k), file);
        done.push(file);
        fresh++;
        o.onPiece?.(assembled(done.map((d) => d.lines)), done.length, pieces.length);
        ctx.log(
          "info",
          `${name}: ${clock(offset + p.from)} – ${clock(offset + p.to)} transcribed, ${lines.length} line(s).`,
        );
      }
    } finally {
      await listener?.stop().catch(() => {});
    }
    for (let k = pieces.length + 1; existsSync(pieceFile(k)); k++) rmSync(pieceFile(k), { force: true });
    rmSync(wavFile, { force: true });
    const languages: Record<string, number> = {};
    for (const d of done)
      for (const [l, s] of Object.entries(d.languages)) languages[l] = Math.round((languages[l] ?? 0) + s);
    if (fresh && coveredS > 1)
      recordPerf({
        at: env.now().toISOString(),
        op: "speech",
        model: o.setup.entry.id,
        runtime: "whispercpp",
        device,
        quantization: o.setup.entry.quantization,
        items: Math.round(coveredS),
        ms: workMs,
      });
    return {
      lines: assembled(done.map((d) => d.lines)),
      languages,
      made,
      device,
      tookMs: Date.now() - t0,
      pieces: pieces.length,
      fresh,
    };
  }, ctx.signal)
    .catch((e) => {
      if (ctx.signal.aborted) throw cancelled();
      throw e;
    })
    .finally(() => {
      busy--;
    });
}
