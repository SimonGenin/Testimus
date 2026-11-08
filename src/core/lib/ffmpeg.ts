import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { run } from "../../shared/run/process.ts";
import { UserError } from "../command.ts";
import { extractZip, llamaIo, sha256File } from "../rag/runtimes/llamacpp.ts";
import type { FfmpegRuntime } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { freeMB } from "./models-download.ts";
import { readRegistry, runtimesDir, updateRegistry } from "./models-registry.ts";
import { readJson } from "./project.ts";

// ponytail: the one ffmpeg build Testimus downloads — gyan.dev's essentials build for win64, pinned by version and
// SHA-256 like llama.cpp; nothing needs admin rights, it lands in the runtimes folder
export const FFMPEG_BUILD = "7.1.1";
export const FFMPEG_ASSET = {
  name: `ffmpeg-${FFMPEG_BUILD}-essentials_build.zip`,
  url: `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_BUILD}/ffmpeg-${FFMPEG_BUILD}-essentials_build.zip`,
  sha256: "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4",
  size: 92234348,
};
const MARKER = "testimus-build.json";
const MB = 1024 * 1024;
const WIN = process.platform === "win32";

function inFolder(dir: string): FfmpegRuntime | null {
  const exe = (n: string) => join(dir, "bin", WIN ? `${n}.exe` : n);
  if (!existsSync(exe("ffmpeg")) || !existsSync(exe("ffprobe"))) return null;
  const marker = readJson<{ build?: string }>(join(dir, MARKER), {});
  return { ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe"), build: marker.build ?? "unknown", via: "download" };
}

// ponytail: on a Mac or Linux (development only: the release is win-x64 and no pinned build exists for them) an ffmpeg
// found on the PATH is taken; on Windows only the pinned download is
export const ffmpegSeam = { onPath: true };

function onPath(): FfmpegRuntime | null {
  if (WIN || !ffmpegSeam.onPath) return null;
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    if (existsSync(join(dir, "ffmpeg")) && existsSync(join(dir, "ffprobe")))
      return { ffmpeg: join(dir, "ffmpeg"), ffprobe: join(dir, "ffprobe"), build: "path", via: "path" };
  return null;
}

export function installedFfmpeg(): FfmpegRuntime | null {
  const r = readRegistry().ffmpeg;
  if (r && existsSync(r.ffmpeg) && existsSync(r.ffprobe)) return r;
  return onPath();
}

export function ffmpegOrFail(): FfmpegRuntime {
  const f = installedFfmpeg();
  if (!f)
    throw new UserError(
      "ffmpeg is not on this PC: a video cannot be read without it.",
      "Run: testimus models pullFfmpeg (one download of 90 MB into the runtimes folder, no admin rights).",
      "ffmpeg-missing",
    );
  return f;
}

export async function pullFfmpegBuild(
  dir: string,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<FfmpegRuntime> {
  if (!WIN && process.env.TESTIMUS_FFMPEG_ANY_OS !== "1") {
    const found = onPath();
    if (found) return found;
    throw new UserError(
      "Testimus downloads ffmpeg for Windows only.",
      "Install ffmpeg with the system's package manager (brew install ffmpeg) so it is on the PATH.",
    );
  }
  const target = join(dir, `ffmpeg-${FFMPEG_BUILD}`);
  const have = inFolder(target);
  if (have && have.build === FFMPEG_BUILD) return have;
  const needMB = Math.ceil((FFMPEG_ASSET.size * 4) / MB);
  const free = freeMB(dir);
  if (free !== null && free < needMB)
    throw new UserError(
      `Not enough free space for ffmpeg ${FFMPEG_BUILD}: ${needMB} MB needed, ${free} MB free on ${dir}.`,
      "Free space on that drive, or move the runtimes folder (testimus models setDir --runtimes).",
    );
  const dl = join(target, ".download");
  mkdirSync(dl, { recursive: true });
  const zip = join(dl, FFMPEG_ASSET.name);
  const part = `${zip}.part`;
  rmSync(part, { force: true });
  try {
    await llamaIo.download(FFMPEG_ASSET.url, part, (l, t) => onProgress(l, t || FFMPEG_ASSET.size), signal);
  } catch (e) {
    rmSync(part, { force: true });
    if (signal.aborted) throw new UserError(`Download of ffmpeg ${FFMPEG_BUILD} cancelled.`);
    throw e;
  }
  const got = await sha256File(part);
  if (got !== FFMPEG_ASSET.sha256) {
    rmSync(part, { force: true });
    throw new UserError(
      `${FFMPEG_ASSET.name} does not match its pinned SHA-256 (got ${got}): deleted.`,
      "Run testimus models pullFfmpeg again; if it fails again, the network may alter downloads (proxy).",
    );
  }
  renameSync(part, zip);
  const unpacked = join(dl, "unpacked");
  extractZip(zip, unpacked);
  if (!existsSync(join(unpacked, "bin")))
    throw new UserError(`The ffmpeg ${FFMPEG_BUILD} zip holds no bin folder.`, "Run testimus models pullFfmpeg again.");
  rmSync(join(target, "bin"), { recursive: true, force: true });
  renameSync(join(unpacked, "bin"), join(target, "bin"));
  for (const f of ["LICENSE", "README.txt"])
    if (existsSync(join(unpacked, f))) writeAtomic(join(target, f), readFileSync(join(unpacked, f)));
  writeAtomic(join(target, MARKER), JSON.stringify({ build: FFMPEG_BUILD, sha256: FFMPEG_ASSET.sha256 }, null, 2));
  rmSync(dl, { recursive: true, force: true });
  const found = inFolder(target);
  if (!found)
    throw new UserError(
      `ffmpeg.exe is missing from the ffmpeg ${FFMPEG_BUILD} zip.`,
      "Run testimus models pullFfmpeg again.",
    );
  return found;
}

export async function pullFfmpeg(
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<FfmpegRuntime> {
  const dir = runtimesDir();
  if (!dir)
    throw new UserError(
      "No models folder is chosen yet: ffmpeg goes into its runtimes folder.",
      "Choose it in Settings › Models, or: testimus models setDir <folder> (--runtimes for the runtimes alone).",
      "models-dir-unset",
    );
  const f = await pullFfmpegBuild(dir, onProgress, signal);
  updateRegistry((r) => {
    r.ffmpeg = f;
  });
  return f;
}

export async function ffmpegVersion(exe: string): Promise<string> {
  const r = await run({ exe, args: ["-version"], timeoutMs: 20000 });
  return (r.stdout.split("\n")[0] ?? "").trim();
}
