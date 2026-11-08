import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ffmpegSeam } from "../lib/ffmpeg.ts";
import { updateRegistry } from "../lib/models-registry.ts";
import { type Probe, videoIo } from "../lib/video-io.ts";
import { clock } from "../rag/anchors.ts";

const SCENE_S = 20;
const SAID = [
  "Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.",
  "Sur le synoptique de traction, on repère le sectionneur S12 entre les deux sous-stations.",
  "Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé.",
  "La fenêtre Propriétés indique un sectionneur sans télécommande, à l'état fermé.",
  "On demande l'autorisation d'ouverture, le message de refus de manœuvre apparaît dans le bandeau d'alarmes.",
  "On acquitte l'alarme, puis on ferme la fenêtre et on revient au synoptique.",
];

// ponytail: an MP4 says its length in its mvhd box (timescale, duration); anything else is a 95-second video, or what a
// JSON description { duration, audio } says
function described(file: string): Probe {
  const b = readFileSync(file);
  const i = b.indexOf("mvhd");
  if (i > 0 && i + 36 < b.length) {
    const v1 = b[i + 4] === 1;
    const scale = b.readUInt32BE(i + (v1 ? 24 : 16));
    const length = v1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
    if (scale) return { duration: length / scale, audio: true, width: 1280, height: 720 };
  }
  try {
    const o = JSON.parse(b.toString("utf8")) as Partial<Probe>;
    if (typeof o.duration === "number")
      return { duration: o.duration, audio: o.audio !== false, width: 1280, height: 720 };
  } catch {}
  return { duration: 95, audio: true, width: 1280, height: 720 };
}

// ponytail: one screen per 20-second scene — a bar whose place says the scene, so frames of a scene look alike (dHash
// keeps one) and two scenes differ
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

// ponytail: --mock reads videos without ffmpeg nor Whisper — ffprobe, the sound, the candidate frames, a frame at a
// moment and the transcript are made up from the file's description; TESTIMUS_MOCK_FFMPEG=absent leaves the PC
// without ffmpeg, TESTIMUS_MOCK_WHISPER=absent without the speech model
export function setupVideoMock(root: string): void {
  ffmpegSeam.onPath = false;
  if (process.env.TESTIMUS_MOCK_FFMPEG !== "absent") {
    const bin = join(root, "runtimes", "ffmpeg-mock", "bin");
    mkdirSync(bin, { recursive: true });
    for (const n of ["ffmpeg", "ffprobe"]) writeFileSync(join(bin, n), "mock\n");
    updateRegistry((r) => {
      r.ffmpeg = { ffmpeg: join(bin, "ffmpeg"), ffprobe: join(bin, "ffprobe"), build: "mock", via: "download" };
    });
  }
  const whisper = process.env.TESTIMUS_MOCK_WHISPER !== "absent";
  videoIo.probe = async (file) => described(file);
  videoIo.sound = async (file) => new Float32Array(Math.round(described(file).duration * 10));
  videoIo.candidates = async (file, dir) => {
    const { duration } = described(file);
    mkdirSync(dir, { recursive: true });
    const out: { at: number; file: string }[] = [];
    for (let at = 0, i = 1; at < duration; at += 5, i++) {
      const f = join(dir, `c-${String(i).padStart(5, "0")}.jpg`);
      writeFileSync(f, await screen(at, 320, 180, false));
      out.push({ at, file: f });
    }
    return out;
  };
  videoIo.frameAt = async (_file, at, out) => {
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, await screen(at, 1280, 720, true));
  };
  videoIo.transcribe = async (pcm) => {
    if (!whisper) return null;
    const duration = pcm.length / 10;
    const lines = [];
    for (let at = 2, i = 0; at < duration; at += 15, i++)
      lines.push({ at, end: Math.min(duration, at + 12), text: SAID[i % SAID.length] });
    return { lines, with: "Whisper small (mock)", language: "french" };
  };
}
