import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { killChildrenOnExit, run, start } from "../../../shared/run/process.ts";
import { sleep, watch } from "../../../shared/run/work.ts";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { writeAtomic } from "../atomic.ts";
import { ffmpegOrFail } from "../ffmpeg.ts";
import { whisperOrFail } from "../whisper.ts";
import type { Token } from "./lines.ts";
import { type Detected, languageCode, type Silence, type Voice } from "./passages.ts";

export type Probe = {
  duration: number;
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
export type ListenerSetup = { model: string; gpu: boolean; threads: number };
export type Shot = { at: number; file: string };

export const SCAN_FPS = 4;
const FRAME_WIDTH = 1920;
const QUIET_MS = 120_000;
const READY_MS = 240_000;
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
        "format=duration:stream=codec_type,codec_name,width,height,color_transfer:stream_tags=language,title",
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
        "Give a video file (.mp4, .mov, .mkv, .webm…).",
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
      }[];
    };
    const video = j.streams?.find((s) => s.codec_type === "video");
    if (!video)
      throw new UserError(`${basename(file)} has no picture.`, "Give a video file; a sound file comes later.");
    const sounds = (j.streams ?? []).filter((s) => s.codec_type === "audio");
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
      ...(video.width ? { width: video.width, height: video.height } : {}),
      audio: sounds.length > 0,
      tracks: sounds.map((s) => ({
        ...(s.tags?.language && s.tags.language !== "und" ? { language: s.tags.language } : {}),
        ...(s.tags?.title ? { title: s.tags.title } : {}),
      })),
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

  async voices(wav: string, signal: AbortSignal): Promise<Voice[]> {
    const w = whisperOrFail();
    const r = await run({
      exe: w.vad,
      args: ["-f", wav, "-vm", w.vadModel, "-vsd", "300", "-vmsd", "15", "-t", String(speechThreads()), "-np"],
      signal,
      timeoutMs: 10 * 60_000,
      priority: "low",
    });
    if (signal.aborted) throw cancelled();
    if (r.code !== 0)
      throw new UserError(
        `The voice detector failed: ${(r.stderr.trim().split("\n").at(-1) ?? r.error ?? "").slice(0, 300)}`,
        "Install the transcription engine again (testimus models pullWhisper), then convert the document again.",
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
    const t0 = Date.now();
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
      if (Date.now() - t0 > READY_MS) {
        await stop();
        throw new UserError(
          "The transcription engine did not get ready in 4 minutes.",
          "Convert the document again; on a PC short of memory, choose the lighter model in Settings › Models › Transcription.",
        );
      }
      await sleep(300, signal).catch(() => {});
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
        let res: Awaited<ReturnType<typeof env.http>>;
        try {
          res = await env.http({
            method: "POST",
            url: `${url}/inference`,
            headers: { "content-type": form.type },
            bodyBytes: form.body,
            timeoutMs: 5 * 60_000,
            signal: sig,
          });
        } catch (e) {
          if (sig.aborted) throw cancelled();
          if (exit !== undefined) throw died();
          throw e;
        }
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

  // ponytail: a light pass over the whole video — 4 frames a second, small, never written — in which mpdecimate keeps
  // a frame only when a block of it changed: the moments something moves somewhere, down to a 40 px alarm
  async changes(file: string, onSeconds: (seconds: number) => void, signal: AbortSignal): Promise<number[]> {
    const r = await ff(
      ["-i", file, "-vf", `fps=${SCAN_FPS}:start_time=0,scale=640:-2,mpdecimate,showinfo`, "-an", "-f", "null", "-"],
      signal,
      { onSeconds },
    );
    return numbers(r.stderr, /pts_time:\s*([\d.]+)/g);
  },

  // ponytail: the frames chosen, by their rank in the 4-a-second pass, drawn in one reading of the video at up to
  // 1920 px — the size at which a message or a button's label is still read
  async shots(
    file: string,
    dir: string,
    ranks: number[],
    o: { hdr: boolean },
    onSeconds: (seconds: number) => void,
    signal: AbortSignal,
  ): Promise<Shot[]> {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const wanted = [...new Set(ranks)].sort((a, b) => a - b);
    if (!wanted.length) return [];
    const script = join(dir, "select.txt");
    const pick = wanted.map((n) => `eq(n\\,${n})`).join("+");
    writeAtomic(
      script,
      `fps=${SCAN_FPS}:start_time=0,select='${pick}',${o.hdr ? `${TONEMAP},` : ""}scale='min(${FRAME_WIDTH}\\,iw)':-2`,
    );
    await ff(
      ["-i", file, "-/filter:v", script, "-an", "-fps_mode", "vfr", "-q:v", "3", join(dir, "c-%05d.jpg")],
      signal,
      { onSeconds },
    );
    rmSync(script, { force: true });
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f, i) => ({ at: (wanted[i] ?? 0) / SCAN_FPS, file: join(dir, f) }));
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
