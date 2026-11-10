import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ffmpegSeam } from "../lib/ffmpeg.ts";
import { putInstall, updateRegistry } from "../lib/models-registry.ts";
import { SPEECH_DEFAULT } from "../lib/video/engine.ts";
import { type Heard, type Probe, SCAN_FPS, videoIo } from "../lib/video/io.ts";
import { header, readWav } from "../lib/video/wav.ts";
import { VAD_MODEL, whisperSeam } from "../lib/whisper.ts";
import { clock } from "../rag/anchors.ts";

const SCENE_S = 20;
const EVERY_S = 15;
const FIRST_S = 2;
const LONG_S = 12;
const RATE = 100;

// ponytail: what the made-up engine hears, a sentence every 15 s — one it doubts (its words come back unsure) and one
// said in German, so the page shows an unsure line and a translation
export const SAID: { text: string; lang: string; p: number }[] = [
  { text: "Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.", lang: "fr", p: 0.94 },
  {
    text: "Sur le synoptique de traction, on repère le sectionneur S12 entre les deux sous-stations.",
    lang: "fr",
    p: 0.92,
  },
  {
    text: "Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé.",
    lang: "fr",
    p: 0.93,
  },
  { text: "La fenêtre Propriétés indique un sectionneur sans télécommande, à l'état fermé.", lang: "fr", p: 0.95 },
  {
    text: "On demande l'autorisation d'ouverture, le message de refus de manœuvre apparaît dans le bandeau d'alarmes.",
    lang: "fr",
    p: 0.48,
  },
  { text: "On acquitte l'alarme, puis on ferme la fenêtre et on revient au synoptique.", lang: "fr", p: 0.93 },
  { text: "So, dann bitte den Trennschalter S12 wieder schließen.", lang: "de", p: 0.96 },
];

// ponytail: an MP4 says its length in its mvhd box (timescale, duration); anything else is a 95-second video, or what a
// JSON description { duration, audio, tracks, hdr, keyEvery } says
function described(file: string): Probe {
  const b = readFileSync(file);
  const base = { audio: true, width: 1280, height: 720, tracks: [{}], hdr: false, codec: "h264", keyEvery: 2 };
  const i = b.indexOf("mvhd");
  if (i > 0 && i + 36 < b.length) {
    const v1 = b[i + 4] === 1;
    const scale = b.readUInt32BE(i + (v1 ? 24 : 16));
    const length = v1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
    if (scale) return { ...base, duration: length / scale, bytes: b.length };
  }
  try {
    const o = JSON.parse(b.toString("utf8")) as Partial<Probe> & { tracks?: number | Probe["tracks"] };
    if (typeof o.duration === "number") {
      const tracks = typeof o.tracks === "number" ? Array.from({ length: o.tracks }, () => ({})) : (o.tracks ?? [{}]);
      const audio = o.audio !== false;
      return {
        ...base,
        ...o,
        duration: o.duration,
        audio,
        tracks: audio ? tracks : [],
        bytes: b.length,
      };
    }
  } catch {}
  return { ...base, duration: 95, bytes: b.length };
}

// ponytail: one screen per 20-second scene — a bar whose place says the scene, so frames of a scene are the same
// screen (one is kept) and two scenes differ
async function screen(at: number, width: number, height: number, label: boolean): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const scene = Math.floor(at / SCENE_S);
  const x = Math.round(((scene * 37) % 80) * (width / 100));
  const text = label
    ? `<text x="24" y="${height - 28}" font-family="sans-serif" font-size="${Math.round(height / 20)}" fill="#ffffff">TCO — scène ${scene + 1} — ${clock(at)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#0f2a3a"/><rect x="${x}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.5)}" fill="#e0b040"/><rect x="0" y="${Math.round(height * 0.75)}" width="100%" height="${Math.round(height * 0.04)}" fill="#2aa198"/>${text}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

// ponytail: the made-up sound says where it is — each sample is the second it belongs to, so a piece or a passage cut
// from it knows its own moment and the made-up engine answers the sentence said there
function firstSecond(wav: Buffer | string): number {
  if (typeof wav !== "string") return wav.length >= 46 ? wav.readInt16LE(44) : 0;
  const w = readWav(wav);
  const b = Buffer.alloc(2);
  const fd = openSync(wav, "r");
  try {
    readSync(fd, b, 0, 2, w.dataAt);
  } finally {
    closeSync(fd);
  }
  return b.readInt16LE(0);
}

function heard(second: number): Heard {
  const k = Math.max(0, Math.round((second + 1 - FIRST_S) / EVERY_S));
  const s = SAID[k % SAID.length];
  const parts = s.text.split(" ");
  const each = (LONG_S - 1) / parts.length;
  return {
    detected: { language: s.lang, p: 0.97, probabilities: { [s.lang]: 0.97 } },
    tokens: parts.map((w, i) => ({
      text: ` ${w}`,
      from: Math.round((0.2 + i * each) * 100) / 100,
      to: Math.round((0.2 + (i + 1) * each) * 100) / 100,
      p: s.p,
    })),
  };
}

export function placeMockWhisper(root: string): void {
  const dir = join(root, "runtimes", "whisper-mock");
  mkdirSync(dir, { recursive: true });
  const exe = (n: string) => join(dir, process.platform === "win32" ? `${n}.exe` : n);
  for (const n of ["whisper-server", "whisper-vad-speech-segments"]) writeFileSync(exe(n), "mock\n");
  writeFileSync(join(dir, VAD_MODEL.name), "mock\n");
  updateRegistry((r) => {
    r.whisper = {
      dir,
      server: exe("whisper-server"),
      vad: exe("whisper-vad-speech-segments"),
      vadModel: join(dir, VAD_MODEL.name),
      build: "mock",
      backend: "cpu",
      via: "download",
    };
  });
  const model = join(root, "speech", "ggml-large-v3-turbo-q8_0.bin");
  mkdirSync(dirname(model), { recursive: true });
  writeFileSync(model, "mock\n");
  putInstall({ model: SPEECH_DEFAULT, via: "path", runtime: "whispercpp", path: model, status: "verified" });
}

// ponytail: --mock reads videos without ffmpeg nor whisper.cpp — ffprobe, the sound, the voice detector, the engine,
// the screens and a frame at a moment are made up from the file's description; TESTIMUS_MOCK_FFMPEG=absent leaves the
// PC without ffmpeg, TESTIMUS_MOCK_WHISPER=absent without the transcription engine and its model
export function setupVideoMock(root: string): void {
  ffmpegSeam.onPath = false;
  whisperSeam.onPath = false;
  if (process.env.TESTIMUS_MOCK_FFMPEG !== "absent") {
    const bin = join(root, "runtimes", "ffmpeg-mock", "bin");
    mkdirSync(bin, { recursive: true });
    for (const n of ["ffmpeg", "ffprobe"]) writeFileSync(join(bin, n), "mock\n");
    updateRegistry((r) => {
      r.ffmpeg = { ffmpeg: join(bin, "ffmpeg"), ffprobe: join(bin, "ffprobe"), build: "mock", via: "download" };
    });
  }
  if (process.env.TESTIMUS_MOCK_WHISPER !== "absent") placeMockWhisper(root);
  videoIo.probe = async (file) => described(file);
  videoIo.sound = async (file, out, o, onSeconds) => {
    const from = o.from ?? 0;
    const length = Math.max(0, (o.to ?? described(file).duration) - from);
    const samples = Math.round(length * RATE);
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) data.writeInt16LE(Math.floor(from + i / RATE), i * 2);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.concat([header(RATE, data.length), data]));
    onSeconds(length);
    return { duration: length, silences: [] };
  };
  videoIo.voices = async (wav) => {
    const start = firstSecond(wav);
    const length = readWav(wav).duration;
    const out = [];
    for (let t = FIRST_S; t < start + length; t += EVERY_S)
      if (t >= start) out.push({ from: t - start, to: Math.min(length, t - start + LONG_S) });
    return out;
  };
  videoIo.listener = async () => ({
    hear: async (wav) => heard(firstSecond(wav)),
    stop: async () => {},
  });
  videoIo.changes = async (file, onSeconds) => {
    const { duration } = described(file);
    onSeconds(duration);
    const out = [];
    for (let t = 0; t < duration; t += SCENE_S) out.push(t);
    return out;
  };
  videoIo.shots = async (_file, dir, ranks) => {
    mkdirSync(dir, { recursive: true });
    const out: { at: number; file: string }[] = [];
    for (const [i, r] of [...new Set(ranks)].sort((a, b) => a - b).entries()) {
      const at = r / SCAN_FPS;
      const f = join(dir, `c-${String(i + 1).padStart(5, "0")}.jpg`);
      writeFileSync(f, await screen(at, 640, 360, false));
      out.push({ at, file: f });
    }
    return out;
  };
  videoIo.frameAt = async (_file, at, out) => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await screen(at, 1280, 720, true));
  };
  videoIo.light = async (file, out, _o, onSeconds) => {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(file, out);
    onSeconds(statSync(file).size ? described(file).duration : 0);
  };
}
