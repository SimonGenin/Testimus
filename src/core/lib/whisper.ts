import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { UserError } from "../command.ts";
import { extractZip, llamaIo, sha256File } from "../rag/runtimes/llamacpp.ts";
import type { MachineProfile, WhisperBackend, WhisperRuntime } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { nvidiaReady, WHISPER_CUDA_DRIVER } from "./fit/placement.ts";
import { freeMB, hfUrl } from "./models-download.ts";
import { readRegistry, runtimesDir, updateRegistry } from "./models-registry.ts";
import { readJson } from "./project.ts";

// ponytail: the one whisper.cpp build Testimus downloads. The tagged versions (v1.9.5) publish no binaries: the Windows
// ones hang on the automatic build of the same day (b5454, 2026-10-06), pinned here by the SHA-256 GitHub publishes for
// each asset and checked on this PC on 2026-11-10. No Vulkan build exists for Windows: a PC without an NVIDIA card
// transcribes on its processor
export const WHISPER_BUILD = "b5454";
const RELEASE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BUILD}/`;
const MARKER = "testimus-build.json";
const MB = 1024 * 1024;
const WIN = process.platform === "win32";

type Asset = { name: string; sha256: string; size: number };

export const WHISPER_ASSETS: Record<WhisperBackend, Asset> = {
  cpu: {
    name: "whisper-bin-x64.zip",
    sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
    size: 8928640,
  },
  cuda: {
    name: "whisper-bin-win-cuda-12.4.0-x64.zip",
    sha256: "afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a",
    size: 684913404,
  },
};

// ponytail: the voice detector that tells speech from silence, music and cabin noise before anything is transcribed —
// Silero v6.2.0 as whisper.cpp reads it (MIT), one small file fetched with the engine
export const VAD_MODEL = {
  name: "ggml-silero-v6.2.0.bin",
  repo: "ggml-org/whisper-vad",
  revision: "9ffd54a1e1ee413ddf265af9913beaf518d1639b",
  sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
  size: 885098,
};

// ponytail: the CUDA 12.4 build runs on an RTX 50 (tried on this PC's 5080: the first start compiles its kernels, about
// 24 s, then the driver keeps them); it weighs 685 MB, so only a PC with an NVIDIA card fetches it
export function chooseWhisperBackend(machine: MachineProfile | null): WhisperBackend {
  return nvidiaReady(machine, WHISPER_CUDA_DRIVER) ? "cuda" : "cpu";
}

const exeIn = (dir: string, name: string) => join(dir, WIN ? `${name}.exe` : name);

export function findWhisperBuild(dir: string): WhisperRuntime | null {
  const server = exeIn(dir, "whisper-server");
  const vad = exeIn(dir, "whisper-vad-speech-segments");
  const vadModel = join(dir, VAD_MODEL.name);
  if (!existsSync(server) || !existsSync(vad) || !existsSync(vadModel)) return null;
  const files = new Set(readdirSync(dir).map((f) => f.toLowerCase()));
  const marker = readJson<{ build?: string }>(join(dir, MARKER), {});
  return {
    dir,
    server,
    vad,
    vadModel,
    build: marker.build ?? "unknown",
    backend: files.has("ggml-cuda.dll") ? "cuda" : "cpu",
    via: "download",
  };
}

// ponytail: on a Mac or Linux (development only) the whisper.cpp programs found on the PATH are taken, with the voice
// detector's file beside the runtimes; on Windows only the pinned download is
export const whisperSeam = { onPath: true };

function onPath(): WhisperRuntime | null {
  if (WIN || !whisperSeam.onPath) return null;
  const root = runtimesDir();
  const vadModel = root ? join(root, VAD_MODEL.name) : "";
  if (!vadModel || !existsSync(vadModel)) return null;
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const server = join(dir, "whisper-server");
    const vad = join(dir, "whisper-vad-speech-segments");
    if (existsSync(server) && existsSync(vad))
      return { dir, server, vad, vadModel, build: "path", backend: "cpu", via: "path" };
  }
  return null;
}

export function installedWhisper(): WhisperRuntime | null {
  const r = readRegistry().whisper;
  if (r && existsSync(r.server) && existsSync(r.vad) && existsSync(r.vadModel)) return r;
  return onPath();
}

export function whisperOrFail(): WhisperRuntime {
  const w = installedWhisper();
  if (!w)
    throw new UserError(
      "The transcription engine (whisper.cpp) is not on this PC: a video cannot be transcribed without it.",
      "Install it in Settings › Models › Transcription, or run: testimus models pullWhisper (no admin rights).",
      "whisper-missing",
    );
  return w;
}

async function fetched(
  url: string,
  file: string,
  want: { sha256: string; size: number; name: string },
  onBytes: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (existsSync(file) && statSync(file).size === want.size && (await sha256File(file)) === want.sha256) {
    onBytes(want.size, want.size);
    return;
  }
  const part = `${file}.part`;
  rmSync(part, { force: true });
  try {
    await llamaIo.download(url, part, (l, t) => onBytes(l, t || want.size), signal);
  } catch (e) {
    rmSync(part, { force: true });
    if (signal.aborted) throw new UserError("Download of the transcription engine cancelled.");
    throw e;
  }
  const got = await sha256File(part);
  if (got !== want.sha256) {
    rmSync(part, { force: true });
    throw new UserError(
      `${want.name} does not match its pinned SHA-256 (got ${got}): deleted.`,
      "Run testimus models pullWhisper again; if it fails again, the network may alter downloads (proxy).",
    );
  }
  renameSync(part, file);
}

export async function pullWhisperBuild(
  backend: WhisperBackend,
  dir: string,
  onProgress: (p: { file: string; loaded: number; total: number }) => void,
  signal: AbortSignal,
): Promise<WhisperRuntime> {
  if (!WIN && process.env.TESTIMUS_WHISPER_ANY_OS !== "1") {
    mkdirSync(dir, { recursive: true });
    await fetched(
      hfUrl(VAD_MODEL.repo, VAD_MODEL.revision, VAD_MODEL.name),
      join(dir, VAD_MODEL.name),
      VAD_MODEL,
      (loaded, total) => onProgress({ file: VAD_MODEL.name, loaded, total }),
      signal,
    );
    const found = onPath();
    if (found) return found;
    throw new UserError(
      "Testimus downloads whisper.cpp for Windows only.",
      "Install whisper.cpp with the system's package manager (brew install whisper-cpp) so whisper-server and whisper-vad-speech-segments are on the PATH.",
    );
  }
  const asset = WHISPER_ASSETS[backend];
  const target = join(dir, `whisper-${WHISPER_BUILD}-${backend}`);
  const marker = readJson<{ build?: string; asset?: string }>(join(target, MARKER), {});
  const have = findWhisperBuild(target);
  if (have && marker.build === WHISPER_BUILD && marker.asset === asset.sha256) return have;
  const needMB = Math.ceil((asset.size * 3.5) / MB);
  const free = freeMB(dir);
  if (free !== null && free < needMB)
    throw new UserError(
      `Not enough free space for whisper.cpp ${WHISPER_BUILD} (${backend}): ${needMB} MB needed, ${free} MB free on ${dir}.`,
      "Free space on that drive, or move the runtimes folder (testimus models setDir --runtimes).",
    );
  const dl = join(target, ".download");
  mkdirSync(dl, { recursive: true });
  const zip = join(dl, asset.name);
  await fetched(
    RELEASE_URL + asset.name,
    zip,
    asset,
    (loaded, total) => onProgress({ file: asset.name, loaded, total }),
    signal,
  );
  extractZip(zip, target);
  await fetched(
    hfUrl(VAD_MODEL.repo, VAD_MODEL.revision, VAD_MODEL.name),
    join(target, VAD_MODEL.name),
    VAD_MODEL,
    (loaded, total) => onProgress({ file: VAD_MODEL.name, loaded, total }),
    signal,
  );
  writeAtomic(join(target, MARKER), JSON.stringify({ build: WHISPER_BUILD, backend, asset: asset.sha256 }, null, 2));
  rmSync(dl, { recursive: true, force: true });
  const found = findWhisperBuild(target);
  if (!found)
    throw new UserError(
      `whisper-server.exe is missing from the whisper.cpp ${WHISPER_BUILD} (${backend}) zip.`,
      "Run testimus models pullWhisper again, or choose the other build with --backend.",
    );
  return found;
}

// ponytail: a seam like llama.cpp's — --mock and the tests place a made-up build instead of downloading one
export const whisperDeps = { pull: pullWhisperBuild };

export async function pullWhisper(
  backend: WhisperBackend,
  signal: AbortSignal,
  onProgress: (p: { file: string; loaded: number; total: number }) => void,
): Promise<WhisperRuntime> {
  const dir = runtimesDir();
  if (!dir)
    throw new UserError(
      "No models folder is chosen yet: the transcription engine goes into its runtimes folder.",
      "Choose it in Settings › Models, or: testimus models setDir <folder> (--runtimes for the runtimes alone).",
      "models-dir-unset",
    );
  const w = await whisperDeps.pull(backend, dir, onProgress, signal);
  updateRegistry((r) => {
    r.whisper = w;
  });
  return w;
}
