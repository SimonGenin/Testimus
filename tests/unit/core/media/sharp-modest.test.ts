import { mkdtempSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sharpOf } from "../../../../src/core/lib/sharp.ts";
import { grid, mosaic, sharpness } from "../../../../src/core/lib/video/frames.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile) };
});

describe("sharp in the core", () => {
  it("takes a quarter of the cores and caches nothing; a frame is read without holding the process", async () => {
    const sharp = await sharpOf();
    expect(sharp.concurrency()).toBe(Math.max(1, Math.floor(os.availableParallelism() / 4)));
    expect(sharp.cache()).toMatchObject({ files: { max: 0 }, items: { max: 0 } });
    const dir = mkdtempSync(join(tmpdir(), "testimus-frames-"));
    const frame = join(dir, "c-000001.jpg");
    writeFileSync(
      frame,
      await sharp({ create: { width: 64, height: 36, channels: 3, background: "#336699" } })
        .jpeg()
        .toBuffer(),
    );
    const reads = vi.mocked(fsp.readFile);
    reads.mockClear();
    expect((await grid(frame)).length).toBe(320 * 180 * 3);
    expect(await sharpness(frame)).toBeGreaterThanOrEqual(0);
    await mosaic(
      [1, 2, 3].map((k) => ({ at: k, file: frame })),
      join(dir, "m.jpg"),
      1,
    );
    expect(reads.mock.calls.filter((c) => String(c[0]) === frame)).toHaveLength(5);
  });
});
