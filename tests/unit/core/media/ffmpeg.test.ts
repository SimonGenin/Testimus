import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { FFMPEG_ASSET, ffmpegSeam, installedFfmpeg } from "../../../../src/core/lib/ffmpeg.ts";
import { readRegistry, updateRegistry } from "../../../../src/core/lib/models-registry.ts";
import { writeZip } from "../../../../src/core/lib/zip.ts";
import { llamaIo } from "../../../../src/core/rag/runtimes/llamacpp.ts";

const realDownload = llamaIo.download;
const pinned = FFMPEG_ASSET.sha256;
const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
const zip = () =>
  Buffer.from(
    writeZip([
      { name: `ffmpeg-7.1.1-essentials_build/bin/${exe("ffmpeg")}`, data: new TextEncoder().encode("ffmpeg") },
      { name: `ffmpeg-7.1.1-essentials_build/bin/${exe("ffprobe")}`, data: new TextEncoder().encode("ffprobe") },
      { name: "ffmpeg-7.1.1-essentials_build/LICENSE", data: new TextEncoder().encode("GPL") },
    ]),
  );
const pull = () => invoke("models.pullFfmpeg", {}, { project: null }) as Promise<{ ffmpeg: string; via: string }>;

beforeEach(() => {
  process.env.TESTIMUS_FFMPEG_ANY_OS = "1";
  ffmpegSeam.onPath = false;
  updateRegistry((r) => {
    delete r.ffmpeg;
    delete r.dir;
    delete r.runtimesDir;
  });
});

afterEach(() => {
  delete process.env.TESTIMUS_FFMPEG_ANY_OS;
  ffmpegSeam.onPath = true;
  llamaIo.download = realDownload;
  FFMPEG_ASSET.sha256 = pinned;
});

describe("models.pullFfmpeg", () => {
  it("needs the runtimes folder first", async () => {
    await expect(pull()).rejects.toThrow("No models folder is chosen yet");
    expect(installedFfmpeg()).toBeNull();
  });

  it("downloads the pinned build, checks its SHA-256, unpacks ffmpeg and ffprobe and registers them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-rt-"));
    updateRegistry((r) => {
      r.runtimesDir = dir;
    });
    const data = zip();
    FFMPEG_ASSET.sha256 = createHash("sha256").update(data).digest("hex");
    const urls: string[] = [];
    llamaIo.download = async (url, file) => {
      urls.push(url);
      writeFileSync(file, data);
    };
    const r = await pull();
    expect(urls).toEqual([
      "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip",
    ]);
    expect(r).toMatchObject({ via: "download", build: "7.1.1" });
    expect(r.ffmpeg).toBe(join(dir, "ffmpeg-7.1.1", "bin", exe("ffmpeg")));
    expect(existsSync(join(dir, "ffmpeg-7.1.1", "LICENSE"))).toBe(true);
    expect(existsSync(join(dir, "ffmpeg-7.1.1", ".download"))).toBe(false);
    expect(readRegistry().ffmpeg?.ffprobe).toBe(join(dir, "ffmpeg-7.1.1", "bin", exe("ffprobe")));
    expect(installedFfmpeg()?.build).toBe("7.1.1");
    await pull();
    expect(urls).toHaveLength(1);
  });

  it("refuses a download whose SHA-256 is not the pinned one, and deletes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-rt-"));
    updateRegistry((r) => {
      r.runtimesDir = dir;
    });
    llamaIo.download = async (_url, file) => writeFileSync(file, "altered by a proxy");
    await expect(pull()).rejects.toThrow("does not match its pinned SHA-256");
    expect(existsSync(join(dir, "ffmpeg-7.1.1", ".download", `${FFMPEG_ASSET.name}.part`))).toBe(false);
    expect(installedFfmpeg()).toBeNull();
  });

  it("is never downloaded on a Mac: the ffmpeg on the PATH is taken, in development only", async () => {
    if (process.platform === "win32") return;
    delete process.env.TESTIMUS_FFMPEG_ANY_OS;
    updateRegistry((r) => {
      r.runtimesDir = mkdtempSync(join(tmpdir(), "testimus-rt-"));
    });
    await expect(pull()).rejects.toThrow("Testimus downloads ffmpeg for Windows only.");
  });
});
