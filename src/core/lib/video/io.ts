import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { killChildrenOnExit, run, start } from "../../../shared/run/process.ts";
import { awake, sleep, TimeoutError, watch } from "../../../shared/run/work.ts";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { writeAtomic } from "../atomic.ts";
import { ffmpegOrFail } from "../ffmpeg.ts";
import { whisperOrFail } from "../whisper.ts";
import type { Token } from "./lines.ts";
import {
  type Detected,
  languageCode,
  passageLimitMs,
  type Silence,
  startLimitMs,
  type Voice,
  voicesLimitMs,
} from "./passages.ts";

export type Probe = {
  duration: number;
  /** false for a recording of sound alone (an attached cover is not a picture) */
  picture: boolean;
  width?: number;
  height?: number;
  audio: boolean;
  tracks: { language?: string; title?: string }[];
  hdr: boolean;
  codec?: string;
  keyEvery?: number;
  bytes: number;
};
export type Sound = { duration: number; silences: Silence[] };
export type Heard = { detected: Detected; tokens: Token[] };
export type Listener = {
  hear(wav: Buffer, o: { language?: string; prompt?: string }, signal: AbortSignal): Promise<Heard>;
  stop(): Promise<void>;
};
export type ListenerSetup = {
  model: string;
  gpu: boolean;
  threads: number;
  /** seconds of sound this PC hears in a second with this model: what a passage's time limit follows */
  speed?: number;
};
export type Shot = { at: number; file: string };
/** a stretch of a video's pictures to read: all of it, or from a second to another; `card` asks the graphics card */
export type Look = { hdr: boolean; from?: number; to?: number; card?: boolean };
export type Seen = { changes: number[]; cuts: number[] };

export const SCAN_FPS = 4;
const FRAME_WIDTH = 1920;
const QUIET_MS = 120_000;
const MB = 1024 * 1024;
const WEEK_MS = 7 * 86_400_000;
export const STALLED = "speech-stalled";
const SILENCE = "silencedetect=n=-35dB:d=0.5";
const HDR = ["arib-std-b67", "smpte2084"];
// ponytail: an iPhone films in HDR by default — drawn as they are its frames come out grey and dull; they are brought
// back to ordinary colours as they are drawn (zscale and tonemap are in the pinned ffmpeg)
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

export const cancelled = () => new UserError("Cancelled.", "Run the conversion again: it goes on where it stopped.");

// ponytail: whisper.cpp slows past the physical cores, and one is left to the rest of the PC; Node only knows the
// logical ones, so half of them is taken for the physical count (right with hyper-threading, careful without)
export function speechThreads(logical = os.availableParallelism()): number {
  return Math.max(logical >= 4 ? 2 : 1, Math.min(8, Math.floor(logical / 2) - 1));
}

type FfOptions = {
  onSeconds?: (seconds: number) => void;
  onLine?: (line: string) => void;
};

// ponytail: ffmpeg is given no fixed deadline — a three-hour video is not a failure. It says how far it is
// (-progress), and it is stopped only when it has said nothing for two minutes; a PC that slept is not stuck (watch)
async function ff(args: string[], signal: AbortSignal, o: FfOptions = {}) {
  const w = watch(QUIET_MS, signal);
  try {
    const r = await run({
      exe: ffmpegOrFail().ffmpeg,
      args: ["-hide_banner", "-nostats", "-y", "-progress", "pipe:1", ...args],
      signal: w.signal,
      priority: "low",
      onLine: (line, stream) => {
        w.beat();
        if (stream === "stdout") {
          const m = /^out_time_us=(\d+)/.exec(line);
          if (m) o.onSeconds?.(Number(m[1]) / 1e6);
        } else o.onLine?.(line);
      },
    });
    if (signal.aborted) throw cancelled();
    if (r.timedOut)
      throw new UserError(
        "ffmpeg stopped answering (nothing for 2 minutes) and was ended.",
        "Convert the document again: what was done is kept. If it stops at the same place, the file may be damaged — convert it to .mp4 first.",
      );
    if (r.code !== 0)
      throw new UserError(
        `ffmpeg failed: ${(r.stderr.trim().split("\n").at(-1) ?? r.error ?? "").slice(0, 300)}`,
        "Check that the file is a video ffmpeg reads (testimus media show <doc>), or convert it to .mp4.",
      );
    return r;
  } finally {
    w.stop();
  }
}

const numbers = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));

// ponytail: a video's pictures are read stretch by stretch, so a stretch read is never read again. A stretch after
// the first starts two frames of the pass early — the first is what the next one is compared with, the second gives
// the scene score its footing — so what changes at the very start of a stretch is found once, as in one reading
const LEAD = 2 / SCAN_FPS;
const CUT = 10;
const CARD = ["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"];
const TURN: Record<string, string> = {
  "0": "",
  "-90": "transpose=clock,",
  "90": "transpose=cclock,",
  "180": "hflip,vflip,",
  "-180": "hflip,vflip,",
};
const offCard = new Set<string>();

export const shotFile = (dir: string, rank: number) => join(dir, `c-${String(rank).padStart(6, "0")}.jpg`);

const stretch = (file: string, start: number, to?: number) => [
  ...(start ? ["-ss", String(start)] : []),
  ...(to !== undefined ? ["-t", String(to - start + LEAD)] : []),
  "-i",
  file,
];

// ponytail: ffmpeg sets a phone's video upright only for frames in memory; frames left on the card are turned here
// the way it would. A mirrored or tilted picture is left to it (the software reading)
async function upright(file: string, signal: AbortSignal): Promise<string> {
  const r = await run({
    exe: ffmpegOrFail().ffprobe,
    args: [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream_side_data=rotation,displaymatrix",
      "-of",
      "json",
      file,
    ],
    signal,
    timeoutMs: 60_000,
  });
  const j = JSON.parse(r.stdout || "{}") as {
    streams?: { side_data_list?: { rotation?: number; displaymatrix?: string }[] }[];
  };
  const side = j.streams?.[0]?.side_data_list?.find((s) => s.displaymatrix);
  if (!side) return "";
  const [a, b, c, d] = [...(side.displaymatrix ?? "").matchAll(/:\s*(-?\d+)\s+(-?\d+)/g)].flatMap((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const turn = a * d - b * c > 0 ? TURN[String(Math.round(side.rotation ?? 0))] : undefined;
  if (turn === undefined) throw new Error("A mirrored or tilted picture is not turned on the card.");
  return turn;
}

// ponytail: a heavy video (a phone's) is decoded by the graphics card — d3d11va, which every card has under Windows —
// and its frames stay on the card until the pass has dropped those it does not look at: 26 in 30 never reach memory.
// Measured with the pinned ffmpeg (RTX 5080 and the Intel chip of the same PC, 24 threads): 40 s of 4K HEVC 10 bits
// in 2.6 s against 3.6 s in software and 10.5 s on 4 threads; 2 min of 1080p H.264 at 20 Mbit/s in 2.8 s against
// 3.1 s and 9.5 s; a tenth of the processor each time, and the frames drawn are the same to the byte. A light video is
// NOT given to the card: the still frames of a screen recording cost software nothing (20 min in 7 s, against 15 s
// on the RTX and 38 s on the Intel chip). `-hwaccel` alone, which brings every frame back to memory, is slower than
// software everywhere (5.5 s, and 47 s for the screen recording): it is not used. What the card refuses (a codec, a
// profile, 10 bits without HDR) fails there and is read again in software, that file never asked of the card again.
// Key frames alone (-skip_frame nokey) are not read either: on the same screen recording they miss 23 changes of 120
// (an alarm that comes and goes between two of them) and see the others up to 8 s late
async function read<T>(
  file: string,
  o: Look,
  signal: AbortSignal,
  pass: (card: string | null) => Promise<T>,
): Promise<T> {
  if (!o.card || process.platform !== "win32" || offCard.has(file)) return pass(null);
  try {
    return await pass(`hwdownload,format=${o.hdr ? "p010le" : "nv12"},${await upright(file, signal)}`);
  } catch (e) {
    if (signal.aborted) throw e;
    offCard.add(file);
    return pass(null);
  }
}

const minutes = (ms: number) => `${Math.round(ms / 6000) / 10} min`;

const stalled = (what: string, ms: number) =>
  new UserError(
    `${what} in ${minutes(ms)} and was ended.`,
    "Convert the document again: the pieces already heard are kept. If it stops at the same place, choose the lighter model in Settings › Models › Transcription.",
    STALLED,
  );

// ponytail: whisper.cpp says nothing while it works on a passage, so its waits have a limit of their own — one that
// follows the length given and this PC's speed (passages.ts) and that sleep does not use up (awake). A limit reached
// is told apart (STALLED): the piece is then tried once more before anything is said
async function limited<T>(
  ms: number,
  what: string,
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await awake(ms, work, signal);
  } catch (e) {
    if (signal.aborted) throw cancelled();
    if (e instanceof TimeoutError) throw stalled(what, ms);
    throw e;
  }
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a ? a.port : 0;
      srv.close(() => res(port));
    });
  });
}

function multipart(fields: Record<string, string>, file: Buffer): { body: Buffer; type: string } {
  const boundary = `----testimus${randomBytes(12).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="passage.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

type Answer = {
  language?: string;
  detected_language?: string;
  detected_language_probability?: number;
  language_probabilities?: Record<string, number>;
  segments?: { words?: { word: string; start: number; end: number; probability: number }[] }[];
  error?: string;
};

export function heardOf(a: Answer, asked?: string): Heard {
  const language = languageCode(asked ?? a.detected_language ?? a.language ?? "");
  const probabilities = a.language_probabilities ?? {};
  return {
    detected: {
      language,
      p: asked ? 1 : (a.detected_language_probability ?? probabilities[language] ?? 0),
      probabilities,
    },
    tokens: (a.segments ?? []).flatMap((s) =>
      (s.words ?? []).map((w) => ({ text: w.word, from: w.start, to: w.end, p: w.probability })),
    ),
  };
}

// ponytail: the real seam — ffprobe for the facts, ffmpeg for the sound (one 16 kHz mono WAV on disk, set on the
// picture's clock), the screens (a light pass over the whole video, then the frames chosen) and a lighter copy;
// whisper.cpp for the voice (its detector on a piece of sound, its server for the passages, the model loaded once for
// a whole video). Everything heavy is a process of its own, started low and killed for real on a cancel: the server
// never holds a sound nor a model. --mock swaps every function (mock/video.ts)
export const videoIo = {
  async probe(file: string, signal: AbortSignal): Promise<Probe> {
    const { ffprobe } = ffmpegOrFail();
    const r = await run({
      exe: ffprobe,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,color_transfer:stream_tags=language,title:stream_disposition=attached_pic",
        "-of",
        "json",
        file,
      ],
      signal,
      timeoutMs: 60_000,
    });
    if (r.code !== 0)
      throw new UserError(
        `ffprobe cannot read ${basename(file)}: ${r.stderr.trim().slice(0, 300)}`,
        "Give a video (.mp4, .mov, .mkv, .webm…) or a sound recording (.mp3, .m4a, .wav…).",
      );
    const j = JSON.parse(r.stdout || "{}") as {
      format?: { duration?: string };
      streams?: {
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        color_transfer?: string;
        tags?: { language?: string; title?: string };
        disposition?: { attached_pic?: number };
      }[];
    };
    const video = j.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    const sounds = (j.streams ?? []).filter((s) => s.codec_type === "audio");
    const tracks = sounds.map((s) => ({
      ...(s.tags?.language && s.tags.language !== "und" ? { language: s.tags.language } : {}),
      ...(s.tags?.title ? { title: s.tags.title } : {}),
    }));
    if (!video) {
      if (!sounds.length)
        throw new UserError(`${basename(file)} has neither picture nor sound.`, "Give a video or a sound recording.");
      return {
        duration: Number(j.format?.duration ?? 0),
        picture: false,
        audio: true,
        tracks,
        hdr: false,
        bytes: statSync(file).size,
      };
    }
    const keys = await run({
      exe: ffprobe,
      args: [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-skip_frame",
        "nokey",
        "-show_entries",
        "frame=pts_time",
        "-read_intervals",
        "%+60",
        "-of",
        "csv=p=0",
        file,
      ],
      signal,
      timeoutMs: 60_000,
    });
    const at = keys.stdout
      .split(/\r?\n/)
      .map((l) => Number.parseFloat(l))
      .filter(Number.isFinite);
    const duration = Number(j.format?.duration ?? 0);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    const keyEvery = gaps.length ? Math.max(...gaps) : at.length ? Math.min(60, duration) : undefined;
    return {
      duration,
      picture: true,
      ...(video.width ? { width: video.width, height: video.height } : {}),
      audio: sounds.length > 0,
      tracks,
      hdr: HDR.includes(video.color_transfer ?? ""),
      ...(video.codec_name ? { codec: video.codec_name } : {}),
      ...(keyEvery !== undefined ? { keyEvery: Math.round(keyEvery * 10) / 10 } : {}),
      bytes: statSync(file).size,
    };
  },

  // ponytail: the sound whole, as one WAV on disk. Each track is first set on the picture's clock (a phone, OBS and
  // Teams all start the sound a little after the picture: left alone, every line would be early by that much), the
  // tracks asked for are mixed (a screen recording keeps the microphone and the PC's sound apart), and the level is
  // raised by one gain measured first — never a compressor, which lifts the noise between sentences into « speech ».
  // ffmpeg also says where the silences are: the sound is cut there
  async sound(
    file: string,
    out: string,
    o: { tracks: number; track?: number; from?: number; to?: number; duration: number },
    onSeconds: (seconds: number) => void,
    signal: AbortSignal,
  ): Promise<Sound> {
    mkdirSync(dirname(out), { recursive: true });
    const picked = o.track !== undefined && o.track < o.tracks ? [o.track] : [...Array(Math.max(1, o.tracks)).keys()];
    const range = [
      ...(o.from ? ["-ss", String(o.from)] : []),
      ...(o.to ? ["-to", String(o.to)] : []),
      "-i",
      file,
      "-vn",
    ];
    const aligned = picked.map((k, i) => `[0:a:${k}]aresample=16000:async=1:first_pts=0[a${i}]`).join(";");
    const mixed =
      picked.length > 1
        ? `${picked.map((_, i) => `[a${i}]`).join("")}amix=inputs=${picked.length}:normalize=0`
        : "[a0]anull";
    const level = await ff(
      [...range, "-filter_complex", `${aligned};${mixed},volumedetect[m]`, "-map", "[m]", "-f", "null", "-"],
      signal,
      { onSeconds: (s) => onSeconds(s / 2) },
    );
    const peak = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(level.stderr)?.[1] ?? Number.NaN);
    const gain = Number.isFinite(peak) && peak < -1.5 ? Math.min(30, -1 - peak) : 0;
    const span = (o.to ?? o.duration) - (o.from ?? 0);
    const r = await ff(
      [
        ...range,
        "-filter_complex",
        `${aligned};${mixed}${gain ? `,volume=${gain.toFixed(1)}dB` : ""},${SILENCE}[m]`,
        "-map",
        "[m]",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        out,
      ],
      signal,
      { onSeconds: (s) => onSeconds(span / 2 + s / 2) },
    );
    const starts = numbers(r.stderr, /silence_start:\s*(-?[\d.]+)/g);
    const ends = numbers(r.stderr, /silence_end:\s*(-?[\d.]+)/g);
    return {
      duration: span,
      silences: starts.map((from, i) => ({ from: Math.max(0, from), to: ends[i] ?? span })),
    };
  },

  async voices(wav: string, signal: AbortSignal, seconds = 0): Promise<Voice[]> {
    const w = whisperOrFail();
    const r = await limited(
      voicesLimitMs(seconds),
      "The voice detector did not finish",
      async (s) => {
        const exit = await run({
          exe: w.vad,
          args: ["-f", wav, "-vm", w.vadModel, "-vsd", "300", "-vmsd", "15", "-t", String(speechThreads()), "-np"],
          signal: s,
          priority: "low",
        });
        if (signal.aborted) throw cancelled();
        if (exit.code !== 0)
          throw new UserError(
            `The voice detector failed: ${(exit.stderr.trim().split("\n").at(-1) ?? exit.error ?? "").slice(0, 300)}`,
            "Install the transcription engine again (testimus models pullWhisper), then convert the document again.",
          );
        return exit;
      },
      signal,
    );
    return [...`${r.stdout}\n${r.stderr}`.matchAll(/start = ([\d.]+), end = ([\d.]+)/g)].map((m) => ({
      from: Number(m[1]) / 100,
      to: Number(m[2]) / 100,
    }));
  },

  // ponytail: one whisper-server for one video — a process per passage would load the model each time (20 s against
  // 3 s for two minutes of sound, measured). It listens on this PC alone, on a port of its own, and goes with the
  // conversion: stopped at its end, killed on a cancel
  async listener(setup: ListenerSetup, signal: AbortSignal): Promise<Listener> {
    const w = whisperOrFail();
    const readyMs = startLimitMs(statSync(setup.model).size / MB);
    killChildrenOnExit();
    const port = await freePort();
    const log: string[] = [];
    const proc = start({
      exe: w.server,
      args: [
        "-m",
        setup.model,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "-t",
        String(setup.threads),
        ...(setup.gpu ? [] : ["-ng"]),
      ],
      cwd: w.dir,
      priority: "low",
      onLine: (line) => {
        log.push(line);
        if (log.length > 40) log.shift();
      },
    });
    let exit: number | null | undefined;
    void proc.exited.then((e) => {
      exit = e.code;
    });
    const url = `http://127.0.0.1:${port}`;
    const stop = () => proc.kill();
    const died = () =>
      new UserError(
        `The transcription engine stopped (exit ${exit}): ${log.slice(-3).join(" · ").slice(0, 400)}`,
        "Convert the document again; if it stops again, choose the lighter model in Settings › Models › Transcription.",
      );
    const ready = watch(readyMs, signal);
    try {
      for (;;) {
        if (signal.aborted) {
          await stop();
          throw cancelled();
        }
        if (exit !== undefined) throw died();
        try {
          const r = await env.http({ method: "GET", url: `${url}/`, timeoutMs: 2000 });
          if (r.status === 200) break;
        } catch {}
        if (ready.signal.aborted && !signal.aborted) {
          await stop();
          throw stalled("The transcription engine did not get ready", readyMs);
        }
        await sleep(300, signal).catch(() => {});
      }
    } finally {
      ready.stop();
    }
    return {
      async hear(wav, o, sig) {
        if (exit !== undefined) throw died();
        const form = multipart(
          {
            response_format: "verbose_json",
            temperature: "0.0",
            temperature_inc: "0.2",
            language: o.language ?? "auto",
            ...(o.prompt ? { prompt: o.prompt } : {}),
          },
          wav,
        );
        const seconds = wav.length > 44 ? (wav.length - 44) / (wav.readUInt32LE(28) || 32_000) : 0;
        const res = await limited(
          passageLimitMs(seconds, setup.speed ?? 1),
          "The transcription engine did not answer a passage",
          async (s) => {
            try {
              return await env.http({
                method: "POST",
                url: `${url}/inference`,
                headers: { "content-type": form.type },
                bodyBytes: form.body,
                timeoutMs: WEEK_MS,
                signal: s,
              });
            } catch (e) {
              if (exit !== undefined) throw died();
              throw e;
            }
          },
          sig,
        );
        const a = JSON.parse(res.text || "{}") as Answer;
        if (res.status !== 200 || a.error)
          throw new UserError(
            `The transcription engine refused a passage: ${a.error ?? `HTTP ${res.status}`}`,
            "Convert the document again.",
          );
        return heardOf(a, o.language);
      },
      stop,
    };
  },

  // ponytail: a light pass over a stretch of the video — 4 frames a second, small, never written — in which mpdecimate
  // keeps a frame only when a block of it changed: the moments something moves somewhere, down to a 40 px alarm. The
  // picture is made small as soon as the frames not looked at are gone (no decoder of H.264 or HEVC makes it small
  // itself). The same pass says where the scene changes (scdet: the picture changed much more than the frame before
  // did, so a steady shake is not a cut) — all a video filmed by hand has, since it changes at every frame
  async changes(file: string, o: Look, onSeconds: (seconds: number) => void, signal: AbortSignal): Promise<Seen> {
    const from = o.from ?? 0;
    const start = Math.max(0, from - LEAD);
    const r = await read(file, o, signal, (card) =>
      ff(
        [
          ...(card ? CARD : []),
          ...stretch(file, start, o.to),
          "-vf",
          `fps=${SCAN_FPS}:start_time=0,${card ?? ""}scale=640:-2,scdet=t=${CUT},mpdecimate,showinfo`,
          "-an",
          "-f",
          "null",
          "-",
        ],
        signal,
        { onSeconds: (s) => onSeconds(start + s) },
      ),
    );
    const mine = (t: number) => t >= from && (o.to === undefined || t < o.to);
    return {
      changes: numbers(r.stderr, /pts_time:\s*([\d.]+)/g)
        .map((t) => start + t)
        .filter(mine),
      cuts: numbers(r.stderr, /lavfi\.scd\.time:\s*([\d.]+)/g)
        .filter((t) => t >= LEAD)
        .map((t) => start + t)
        .filter(mine),
    };
  },

  // ponytail: the frames chosen in a stretch, by their rank in the 4-a-second pass, drawn in one reading of that
  // stretch at up to 1920 px — the size at which a message or a button's label is still read. Each is named by its
  // rank and set in the folder only once the reading is over: a frame that is there is whole, and is not drawn again
  async shots(
    file: string,
    dir: string,
    ranks: number[],
    o: Look,
    onSeconds: (seconds: number) => void,
    signal: AbortSignal,
  ): Promise<Shot[]> {
    const wanted = [...new Set(ranks)].sort((a, b) => a - b);
    if (!wanted.length) return [];
    const start = Math.max(0, (o.from ?? 0) - LEAD);
    const part = join(dir, "part");
    const pick = wanted.map((n) => `eq(n\\,${n - start * SCAN_FPS})`).join("+");
    await read(file, o, signal, (card) => {
      rmSync(part, { recursive: true, force: true });
      mkdirSync(part, { recursive: true });
      const script = join(part, "select.txt");
      writeAtomic(
        script,
        `fps=${SCAN_FPS}:start_time=0,select='${pick}',${card ?? ""}${o.hdr ? `${TONEMAP},` : ""}scale='min(${FRAME_WIDTH}\\,iw)':-2`,
      );
      return ff(
        [
          ...(card ? CARD : []),
          ...stretch(file, start, o.to),
          "-/filter:v",
          script,
          "-an",
          "-fps_mode",
          "vfr",
          "-q:v",
          "3",
          join(part, "c-%05d.jpg"),
        ],
        signal,
        { onSeconds: (s) => onSeconds(start + s) },
      );
    });
    const shots = readdirSync(part)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .slice(0, wanted.length)
      .map((f, i) => {
        const out = shotFile(dir, wanted[i]);
        renameSync(join(part, f), out);
        return { at: wanted[i] / SCAN_FPS, file: out };
      });
    rmSync(part, { recursive: true, force: true });
    return shots;
  },

  async frameAt(file: string, at: number, out: string, o: { hdr: boolean }, signal: AbortSignal): Promise<void> {
    mkdirSync(dirname(out), { recursive: true });
    await ff(
      [
        "-ss",
        String(Math.max(0, at)),
        "-i",
        file,
        "-frames:v",
        "1",
        ...(o.hdr ? ["-vf", TONEMAP] : []),
        "-q:v",
        "2",
        out,
      ],
      signal,
    );
  },

  // ponytail: a copy the page plays whatever the PC — H.264 720p with a key frame every 2 s, so a jump to an anchor
  // lands at once; made only when the original does not play in the page or moves badly
  async light(
    file: string,
    out: string,
    o: { hdr: boolean },
    onSeconds: (seconds: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    mkdirSync(dirname(out), { recursive: true });
    const part = `${out}.part.mp4`;
    try {
      await ff(
        [
          "-i",
          file,
          "-vf",
          `${o.hdr ? `${TONEMAP},` : ""}scale=-2:'min(720\\,ih)',format=yuv420p`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-force_key_frames",
          "expr:gte(t,n_forced*2)",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          part,
        ],
        signal,
        { onSeconds },
      );
      rmSync(out, { force: true });
      renameSync(part, out);
    } finally {
      rmSync(part, { force: true });
    }
  },
};
