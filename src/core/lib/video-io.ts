import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { run } from "../../shared/run/process.ts";
import { UserError } from "../command.ts";
import { ffmpegOrFail } from "./ffmpeg.ts";
import { catalog } from "./models-catalog.ts";
import { installsOf } from "./models-registry.ts";
import { findModel } from "./models-store.ts";

export type Probe = { duration: number; width?: number; height?: number; audio: boolean };
export type Heard = { at: number; end: number; text: string };
export type Speech = { lines: Heard[]; with: string; language?: string };

const FRAME_WIDTH = 640;
export const EVERY_S = 5;
const SCENE = 0.3;

async function ff(args: string[], signal: AbortSignal, timeoutMs = 30 * 60_000) {
  const r = await run({
    exe: ffmpegOrFail().ffmpeg,
    args: ["-hide_banner", "-nostats", "-y", ...args],
    signal,
    timeoutMs,
  });
  if (r.cancelled) throw new UserError("Cancelled.", "Run the conversion again.");
  if (r.code !== 0)
    throw new UserError(
      `ffmpeg failed: ${(r.stderr.trim().split("\n").at(-1) ?? r.error ?? "").slice(0, 300)}`,
      "Check that the file is a video ffmpeg reads (testimus media show <doc>), or convert it to .mp4.",
    );
  return r;
}

// ponytail: the speech model is the catalog's speech entry installed on this PC (models pull whisper-small-q8) — never
// downloaded by a conversion on its own (the user decides where big files go)
export function speechModel(): { id: string; dir: string; label: string } | null {
  for (const e of catalog().entries.filter((x) => x.kind === "speech")) {
    const path = installsOf(e.id).find((i) => i.path)?.path;
    const dir = path ?? (e.source.hf ? findModel(e.source.hf.repo)?.dir : undefined);
    if (dir) return { id: e.id, dir, label: e.label };
  }
  return null;
}

type Asr = (
  audio: Float32Array,
  o: object,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;
const asrs = new Map<string, Promise<Asr>>();

async function loadAsr(dir: string): Promise<Asr> {
  const t = await import("@huggingface/transformers");
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = false;
  t.env.localModelPath = dirname(dirname(dir));
  const id = `${basename(dirname(dir))}/${basename(dir)}`;
  const make = t.pipeline as unknown as (task: string, id: string, o: object) => Promise<Asr>;
  return make("automatic-speech-recognition", id, { dtype: "q8", device: "cpu" });
}

// ponytail: the real seam — ffprobe for the facts, ffmpeg for the sound (16 kHz mono float), the candidate frames (a
// scene change, else one every 5 s) and a frame at a moment; Whisper (transformers.js, on this PC) for the speech.
// --mock swaps every function (mock/video.ts), so tests and e2e need no ffmpeg and no model
export const videoIo = {
  async probe(file: string, signal: AbortSignal): Promise<Probe> {
    const r = await run({
      exe: ffmpegOrFail().ffprobe,
      args: ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file],
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
      streams?: { codec_type?: string; width?: number; height?: number }[];
    };
    const video = j.streams?.find((s) => s.codec_type === "video");
    if (!video)
      throw new UserError(`${basename(file)} has no picture.`, "Give a video file; a sound file comes later.");
    return {
      duration: Number(j.format?.duration ?? 0),
      ...(video.width ? { width: video.width, height: video.height } : {}),
      audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    };
  },
  async sound(file: string, tmp: string, signal: AbortSignal): Promise<Float32Array> {
    mkdirSync(dirname(tmp), { recursive: true });
    await ff(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", tmp], signal);
    const b = readFileSync(tmp);
    rmSync(tmp, { force: true });
    return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
  },
  async candidates(file: string, dir: string, signal: AbortSignal): Promise<{ at: number; file: string }[]> {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const select = `select='isnan(prev_selected_t)+gt(scene\\,${SCENE})+gte(t-prev_selected_t\\,${EVERY_S})'`;
    const r = await ff(
      [
        "-i",
        file,
        "-vf",
        `${select},scale='min(${FRAME_WIDTH}\\,iw)':-2,showinfo`,
        "-fps_mode",
        "vfr",
        "-q:v",
        "4",
        join(dir, "c-%05d.jpg"),
      ],
      signal,
    );
    const times = [...r.stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f, i) => ({ at: times[i] ?? i * EVERY_S, file: join(dir, f) }));
  },
  async frameAt(file: string, at: number, out: string, signal: AbortSignal): Promise<void> {
    mkdirSync(dirname(out), { recursive: true });
    await ff(["-ss", String(Math.max(0, at)), "-i", file, "-frames:v", "1", "-q:v", "2", out], signal, 120_000);
  },
  async transcribe(pcm: Float32Array, language: string, signal: AbortSignal): Promise<Speech | null> {
    const m = speechModel();
    if (!m) return null;
    let asr = asrs.get(m.dir);
    if (!asr) {
      asr = loadAsr(m.dir);
      asr.catch(() => asrs.delete(m.dir));
      asrs.set(m.dir, asr);
    }
    if (signal.aborted) throw new UserError("Cancelled.", "Run the conversion again.");
    const lang = language.toLowerCase().startsWith("fr")
      ? "french"
      : language.toLowerCase().startsWith("en")
        ? "english"
        : undefined;
    const out = await (await asr)(pcm, {
      task: "transcribe",
      ...(lang ? { language: lang } : {}),
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const lines = (out.chunks ?? [])
      .map((c) => ({ at: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0, text: c.text.trim() }))
      .filter((l) => l.text);
    return { lines, with: m.label, ...(lang ? { language: lang } : {}) };
  },
};
