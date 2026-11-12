import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Exit, RunSpec } from "../../../../src/shared/run/process.ts";

const procs = vi.hoisted(() => ({ run: null as ((spec: RunSpec) => Promise<Exit>) | null }));

vi.mock("../../../../src/shared/run/process.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/shared/run/process.ts")>();
  return { ...real, run: (spec: RunSpec) => (procs.run ? procs.run(spec) : real.run(spec)) };
});

const { FFMPEG_AT_ONCE, videoIo } = await import("../../../../src/core/lib/video/io.ts");
const { setupVideoMock } = await import("../../../../src/core/mock/video.ts");

const exit = (): Exit => ({ code: 0, stdout: "", stderr: "", cancelled: false, timedOut: false });
const realIo = { ...videoIo };

afterEach(() => {
  procs.run = null;
  Object.assign(videoIo, realIo);
});

describe("ffmpeg on this PC", () => {
  it("runs two at a time whatever the conversions asking; one cancelled while it waits never starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "testimus-ffcap-"));
    setupVideoMock(root);
    let now = 0;
    let most = 0;
    let started = 0;
    const ends: (() => void)[] = [];
    procs.run = async (spec) => {
      if (basename(spec.exe) !== "ffmpeg") return exit();
      started++;
      now++;
      most = Math.max(most, now);
      await new Promise<void>((r) => ends.push(r));
      now--;
      return exit();
    };
    const signal = new AbortController().signal;
    const frames = [1, 2, 3, 4].map((k) =>
      realIo.frameAt("video.mp4", k, join(root, "out", `${k}.jpg`), { hdr: false }, signal),
    );
    const ctl = new AbortController();
    const cancelled = realIo.frameAt("video.mp4", 5, join(root, "out", "5.jpg"), { hdr: false }, ctl.signal);
    await new Promise((r) => setImmediate(r));
    expect(started).toBe(FFMPEG_AT_ONCE);
    ctl.abort();
    await expect(cancelled).rejects.toThrow("Cancelled.");
    while (ends.length || started < 4) {
      ends.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(frames);
    expect(started).toBe(4);
    expect(most).toBe(2);
  });
});
