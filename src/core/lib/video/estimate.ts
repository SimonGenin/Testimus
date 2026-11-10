import { dirname } from "node:path";
import type { MachineProfile, VideoDensity } from "../../types.ts";
import { nvidiaReady, WHISPER_CUDA_DRIVER } from "../fit/placement.ts";
import { freeMB } from "../models-download.ts";
import { installedWhisper } from "../whisper.ts";
import { activeSpeech, speechSpeed } from "./engine.ts";
import { keyFrameBudget } from "./frames.ts";
import { speechThreads } from "./io.ts";
import { partsOf, WHOLE_S } from "./survey.ts";

const MB = 1024 * 1024;
const LONG_S = 2 * 3600;
const FRAMES_SPEED = 12;
const PICTURES_A_RUN = 20;
const WAV_MB_PER_HOUR = 115;

export type Estimate = {
  duration: number;
  bytes: number;
  audio: boolean;
  tracks: number;
  model?: string;
  missing?: "engine" | "model";
  device: "gpu" | "cpu";
  speechSeconds: number;
  measured: boolean;
  withCardSeconds?: number;
  framesSeconds: number;
  seconds: number;
  claude: { runs: number; images: number };
  long: boolean;
  disk: { needMB: number; freeMB: number | null };
};

// ponytail: what a video will cost before it is imported — how long this PC takes to hear it (from the speed its last
// transcriptions measured here, else a careful guess), how long to look through it, Claude's share (its runs, the
// pictures it reads), and the room it takes. Past two hours it says so: a part can be transcribed instead of the whole
export function estimateOf(
  probe: { duration: number; bytes: number; audio: boolean; tracks: number },
  machine: MachineProfile | null,
  o: { density?: VideoDensity; claude: boolean; folder: string },
): Estimate {
  const w = installedWhisper();
  const m = activeSpeech();
  const threads = speechThreads(machine?.cpu.threads);
  const card = nvidiaReady(machine, WHISPER_CUDA_DRIVER);
  const device = w?.backend === "cuda" && card ? "gpu" : "cpu";
  const speed = m ? speechSpeed(m.entry, device, threads) : { speed: 4, measured: false };
  const speechSeconds = probe.audio ? Math.round(probe.duration / Math.max(0.2, speed.speed)) : 0;
  const withCard = m && card && device === "cpu" ? speechSpeed(m.entry, "gpu", threads) : null;
  const framesSeconds = Math.round((probe.duration / FRAMES_SPEED) * 2);
  const images = keyFrameBudget(probe.duration, o.density);
  const surveys = probe.duration <= WHOLE_S ? 1 : 1 + partsOf([], probe.duration).length;
  const need = Math.ceil(
    probe.bytes / MB +
      (probe.duration / 3600) * WAV_MB_PER_HOUR +
      images * 0.4 +
      Math.min(600, probe.duration / 5) * 0.3,
  );
  let free: number | null = null;
  try {
    free = freeMB(dirname(o.folder));
  } catch {}
  return {
    duration: probe.duration,
    bytes: probe.bytes,
    audio: probe.audio,
    tracks: probe.tracks,
    ...(m ? { model: m.entry.label } : {}),
    ...(!w ? { missing: "engine" as const } : !m ? { missing: "model" as const } : {}),
    device,
    speechSeconds,
    measured: speed.measured,
    ...(withCard ? { withCardSeconds: Math.round(probe.duration / withCard.speed) } : {}),
    framesSeconds,
    seconds: speechSeconds + framesSeconds,
    claude: o.claude ? { runs: surveys + Math.ceil(images / PICTURES_A_RUN), images } : { runs: 0, images: 0 },

    long: probe.duration > LONG_S,
    disk: { needMB: need, freeMB: free },
  };
}
