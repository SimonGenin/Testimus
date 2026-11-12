import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileAtomic, copyingLine } from "../../../../src/core/lib/atomic.ts";
import { addDoc } from "../../../../src/core/lib/docs-convert.ts";
import { copyMediaFiles, newMediaDoc } from "../../../../src/core/lib/media.ts";
import { addMediaDocs } from "../../../../src/core/lib/media-add.ts";
import * as download from "../../../../src/core/lib/models-download.ts";
import { videosMB } from "../../../../src/core/lib/video/disk.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { fixtureCopy } from "../registry.ts";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, createReadStream: vi.fn(real.createReadStream), readdirSync: vi.fn(real.readdirSync) };
});
vi.mock("../../../../src/core/lib/models-download.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/models-download.ts")>();
  return { ...real, freeMB: vi.fn(real.freeMB) };
});

const MB = 1024 * 1024;
const reads = vi.mocked(fs.createReadStream);
const free = vi.mocked(download.freeMB);
let P = "";
let client = "";

const big = (name: string, mb: number) => {
  const file = join(client, name);
  writeFileSync(file, Buffer.alloc(mb * MB, 7));
  return file;
};
const readsOf = (file: string) => reads.mock.calls.filter((c) => String(c[0]) === file).length;
const tmps = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? tmps(join(dir, e.name)) : e.name.endsWith(".tmp") ? [join(dir, e.name)] : [],
      )
    : [];

beforeEach(() => {
  P = fixtureCopy("copy-stream");
  client = mkdtempSync(join(tmpdir(), "testimus-client-"));
  reads.mockClear();
  free.mockReset();
  free.mockReturnValue(1_000_000);
});

afterEach(() => {
  free.mockReset();
});

describe("a user's file copied into the project", () => {
  it("is read once: hashed as it streams into place", async () => {
    const file = big("clip.mp4", 3);
    newMediaDoc(P, { id: "V", title: "V", name: file });
    const r = await copyMediaFiles(P, "V", [{ path: file }]);
    const want = createHash("sha256")
      .update(Buffer.alloc(3 * MB, 7))
      .digest("hex");
    expect(r.added[0]).toMatchObject({ file: "files/clip.mp4", sha256: want });
    expect(readsOf(file)).toBe(1);
  });

  it("says how far it is in bytes, at most once a hundredth", async () => {
    const file = big("clip.mp4", 50);
    const seen: [string, number, number][] = [];
    const r = await addMediaDocs(P, [{ path: file }], {}, undefined, (name, done, total) =>
      seen.push([name, done, total]),
    );
    expect(r.added).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.length).toBeLessThanOrEqual(101);
    expect(seen.every(([n, , t]) => n === "clip.mp4" && t === 50 * MB)).toBe(true);
    expect(seen.map(([, d]) => d)).toEqual([...seen.map(([, d]) => d)].sort((a, b) => a - b));
    expect(seen.at(-1)?.[1]).toBe(50 * MB);
    expect(copyingLine("clip.mp4", 2.1 * 1024 ** 3, 5.4 * 1024 ** 3)).toBe("Copying clip.mp4 — 2.1 / 5.4 GB");
    expect(copyingLine("a.docx", 3 * MB, 12 * MB)).toBe("Copying a.docx — 3 / 12 MB");
  });

  it("cancelled half-way leaves neither a .tmp nor a half document folder", async () => {
    const file = big("long.mp4", 50);
    const ctl = new AbortController();
    const before = readdirSync(join(P, "docs"));
    const going = addMediaDocs(P, [{ path: file }], {}, ctl.signal, (_n, done, total) => {
      if (done >= total / 2) ctl.abort(new Error("Cancelled."));
    });
    await expect(going).rejects.toThrow();
    expect(readdirSync(join(P, "docs"))).toEqual(before);
    expect(tmps(join(P, "docs"))).toEqual([]);

    const to = join(client, "out", "copy.bin");
    const ctl2 = new AbortController();
    await expect(
      copyFileAtomic(file, to, { signal: ctl2.signal, onBytes: () => ctl2.abort(new Error("Cancelled.")) }),
    ).rejects.toThrow();
    expect(existsSync(to)).toBe(false);
    expect(existsSync(`${to}.tmp`)).toBe(false);
  });

  it("larger than the drive's free room is refused before it is read — a picture as a video, a Word document too", async () => {
    free.mockReturnValue(100);
    const video = big("huge.mp4", 80);
    const r = await addMediaDocs(P, [{ path: video }], {});
    expect(r.added).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ name: "huge.mp4", code: "failed" });
    expect(r.rejected[0].why).toMatch(/Not enough room on the project's drive: huge\.mp4 needs about 320 MB/);
    const picture = big("scan.jpg", 1);
    free.mockReturnValue(150);
    const p = await addMediaDocs(P, [{ path: picture }], {});
    expect(p.rejected[0].why).toMatch(/needs about 201 MB and 150 MB are free/);
    const docx = join(client, "SPEC_ROOM_01_00.docx");
    writeFileSync(docx, sampleDocx());
    await expect(addDoc(P, { file: docx, convert: false })).rejects.toThrow(/Not enough room/);
    expect(existsSync(join(P, "docs", "SPEC_ROOM"))).toBe(false);
    expect(readsOf(video) + readsOf(picture) + readsOf(docx)).toBe(0);
  });

  it("the room the videos take is walked again only for a video whose doc.json moved", async () => {
    const file = big("clip.mp4", 2);
    const id = (await addMediaDocs(P, [{ path: file }], {})).added[0].id;
    const walks = vi.mocked(fs.readdirSync);
    const walked = () => walks.mock.calls.filter((c) => String(c[0]).startsWith(join(P, "docs", id))).length;
    walks.mockClear();
    expect(videosMB(P)).toBe(2);
    expect(walked()).toBeGreaterThan(0);
    walks.mockClear();
    videosMB(P);
    expect(walked()).toBe(0);
    writeFileSync(join(P, "docs", id, "files", "more.bin"), Buffer.alloc(MB));
    const doc = join(P, "docs", id, "doc.json");
    fs.utimesSync(doc, new Date(), new Date(Date.now() + 5000));
    expect(videosMB(P)).toBe(3);
    expect(walked()).toBeGreaterThan(0);
  });
});
