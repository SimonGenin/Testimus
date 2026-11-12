import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as draw from "../../../../src/core/lib/frames/draw.ts";
import {
  crop,
  distinct,
  framesIo,
  framesTimeouts,
  IDLE_MS,
  liveFramesWorker,
  mosaic,
  normalizeFrame,
  preparePicture,
  sharpness,
  stopFramesWorker,
  sweepIdle,
} from "../../../../src/core/lib/frames/frames-process.ts";
import { stopAllServers } from "../../../../src/core/rag/runtimes/llamacpp.ts";
import { isAlive } from "../../../../src/shared/run/process.ts";
import { sleep } from "../../../../src/shared/run/work.ts";

const FAKE = fileURLToPath(new URL("../../helpers/fake-frames-worker.ts", import.meta.url));
const saved = { ...framesIo };
const idle = framesTimeouts.idleMs;
let dir = "";
const at = (name: string) => join(dir, name);

const screen = (alarm: boolean, blur = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#0f2a3a"/><rect x="200" y="200" width="300" height="200" fill="#e0b040"/>${alarm ? '<rect x="1100" y="40" width="40" height="40" fill="#ff0000"/>' : ""}${blur ? "" : '<text x="40" y="660" font-size="40" fill="#ffffff">PCC — synoptique</text>'}</svg>`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "testimus-frames-"));
  writeFileSync(
    at("a.jpg"),
    await sharp(Buffer.from(screen(false)))
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
  writeFileSync(
    at("b.jpg"),
    await sharp(Buffer.from(screen(false)))
      .jpeg({ quality: 80 })
      .toBuffer(),
  );
  writeFileSync(
    at("c.png"),
    await sharp(Buffer.from(screen(true)))
      .png()
      .toBuffer(),
  );
  writeFileSync(
    at("d.jpg"),
    await sharp(Buffer.from(screen(true, true)))
      .blur(6)
      .jpeg()
      .toBuffer(),
  );
  // a photo held on its side, with the moment it was taken, and a transparent PNG
  writeFileSync(
    at("photo.jpg"),
    await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#336699" } })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { DateTime: "2026:11:10 09:30:12" } })
      .jpeg()
      .toBuffer(),
  );
  writeFileSync(
    at("clear.png"),
    await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.2 } } })
      .png()
      .toBuffer(),
  );
});

afterEach(async () => {
  await stopFramesWorker();
  Object.assign(framesIo, saved);
  framesTimeouts.idleMs = idle;
});

describe("the frames worker, seen from the core", () => {
  it("the program it starts is the worker file beside it, below normal priority; ten minutes idle", async () => {
    framesIo.priority = "low";
    await sharpness([at("a.jpg")]);
    expect(os.getPriority(liveFramesWorker()?.proc.pid)).toBe(os.constants.priority.PRIORITY_BELOW_NORMAL);
    expect(existsSync(saved.script())).toBe(true);
    expect(saved.script()).toMatch(/frames-worker\.ts$/);
    expect(IDLE_MS).toBe(10 * 60 * 1000);
  });

  it("draws in a child process: the same numbers and the same files, byte for byte, as drawn in this one", async () => {
    const files = ["a.jpg", "b.jpg", "c.png", "d.jpg"].map(at);
    const sharps = await sharpness(files);
    const w = liveFramesWorker();
    expect(w?.proc.pid).toBeTypeOf("number");
    expect(w?.proc.pid).not.toBe(process.pid);
    const here = [];
    for (const f of files) here.push(await draw.sharpness(f));
    expect(sharps).toEqual(here);
    expect(sharps[3]).toBeLessThan(sharps[0]);

    const frames = files.map((file, k) => ({ at: k, file, tag: `t${k}` }));
    const kept = await distinct(frames);
    expect(kept.map((k) => k.tag)).toEqual(["t0", "t2", "t3"]);
    expect(kept[1].box).toEqual([0.8125, 0, 0.125, 1 / 9]);
    expect(kept[1]).toMatchObject({ at: 2, file: files[2] });
    expect(await draw.distinct(files)).toEqual([{ i: 0 }, { i: 2, box: kept[1].box }, { i: 3, box: kept[2].box }]);

    const box = kept[1].box as [number, number, number, number];
    expect(await crop(files[2], box, at("crop-w.jpg"))).toEqual(await draw.crop(files[2], box, at("crop-h.jpg")));
    expect(readFileSync(at("crop-w.jpg"))).toEqual(readFileSync(at("crop-h.jpg")));
    expect(await crop(files[2], [0, 0, 1, 1], at("none.jpg"))).toBeNull();

    const tiles = frames.map((f) => ({ at: f.at * 61, file: f.file, ...(f.at === 2 ? { box } : {}) }));
    await mosaic(tiles, at("mosaic-w.jpg"), 4);
    await draw.mosaic(tiles, at("mosaic-h.jpg"), 4);
    expect(readFileSync(at("mosaic-w.jpg"))).toEqual(readFileSync(at("mosaic-h.jpg")));
    expect((await sharp(at("mosaic-w.jpg")).metadata()).width).toBe(1440);

    expect(await normalizeFrame(files[2], at("key-w.jpg"))).toEqual({ width: 1280, height: 720 });
    await draw.normalizeFrame(files[2], at("key-h.jpg"));
    expect(readFileSync(at("key-w.jpg"))).toEqual(readFileSync(at("key-h.jpg")));
    expect(liveFramesWorker()).toBe(w);
  });

  it("prepares an images document's picture: turned upright, at most 2000 px, on white, with its date", async () => {
    expect(await preparePicture(at("photo.jpg"), at("photo-w.jpg"))).toEqual({
      width: 667,
      height: 2000,
      takenAt: "2026-11-10T09:30:12",
    });
    await draw.preparePicture(at("photo.jpg"), at("photo-h.jpg"));
    expect(readFileSync(at("photo-w.jpg"))).toEqual(readFileSync(at("photo-h.jpg")));
    expect(await preparePicture(at("clear.png"), at("clear.jpg"))).toEqual({ width: 400, height: 300 });
    const { data } = await sharp(at("clear.jpg")).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(190);
    await expect(preparePicture(at("missing.jpg"), at("x.jpg"))).rejects.toThrow(/missing\.jpg|no such file/i);
    expect(liveFramesWorker()?.exitCode).toBeUndefined();
  });

  it("sharp in the worker takes a quarter of the cores and caches nothing", async () => {
    const s = await draw.sharpOf();
    expect(s.concurrency()).toBe(Math.max(1, Math.floor(os.availableParallelism() / 4)));
    expect(s.cache()).toMatchObject({ files: { max: 0 }, items: { max: 0 } });
  });

  it("nothing to draw starts nothing", async () => {
    expect(await sharpness([])).toEqual([]);
    expect(await distinct([])).toEqual([]);
    expect(liveFramesWorker()).toBeNull();
  });
});

describe("the frames worker, cancelled, dead or idle", () => {
  it("a cancelled job's call leaves at once, the worker stops at its next picture and serves the next ask", async () => {
    framesIo.script = () => FAKE;
    const ctrl = new AbortController();
    const files = Array.from({ length: 20 }, (_, i) => at(`slow-${i}.jpg`));
    const slow = sharpness(files, ctrl.signal);
    const w = liveFramesWorker();
    while (!w?.stderr.some((l) => l.startsWith("drew"))) await sleep(5);
    const t0 = Date.now();
    ctrl.abort();
    await expect(slow).rejects.toThrow(/Cancelled/);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(w.busy).toBe(0);
    await sleep(400);
    expect(w.stderr.filter((l) => l.startsWith("drew")).length).toBeLessThanOrEqual(3);
    expect(await sharpness([at("slow-next.jpg")])).toEqual([1]);
    expect(liveFramesWorker()).toBe(w);
    const pre = new AbortController();
    pre.abort();
    await expect(sharpness([at("a.jpg")], pre.signal)).rejects.toThrow(/Cancelled/);
  });

  it("an error fails that call only", async () => {
    framesIo.script = () => FAKE;
    await expect(sharpness([at("fail.jpg")])).rejects.toThrow(/Input file is missing/);
    expect(await sharpness([at("slow.jpg")])).toEqual([1]);
  });

  it("a worker that dies fails what it was doing with its last words, and the next call starts another", async () => {
    framesIo.script = () => FAKE;
    await sharpness([at("slow-warm.jpg")]);
    const first = liveFramesWorker();
    await expect(sharpness([at("crash.jpg")])).rejects.toThrow(
      /The frames process stopped \(exit code 3\)\.\nfake frames worker\ndrew slow-warm\.jpg/,
    );
    expect(liveFramesWorker()).toBeNull();
    expect(await sharpness([at("slow-again.jpg")])).toEqual([1]);
    expect(liveFramesWorker()).not.toBe(first);
  });

  it("a worker that cannot start fails the call and says why", async () => {
    framesIo.start = (args, onLine) => saved.start(["D:/nowhere/frames-worker-missing.ts", ...args.slice(1)], onLine);
    await expect(sharpness([at("a.jpg")])).rejects.toThrow(/The frames process stopped \(exit code 1\)/);
  });

  it("stops after the idle delay, not while it works; the memory goes with the process", async () => {
    let now = 1_000_000;
    framesIo.now = () => now;
    await sharpness([at("a.jpg")]);
    const w = liveFramesWorker();
    const pid = w?.proc.pid as number;
    now += IDLE_MS - 1;
    expect(await sweepIdle(now)).toBe(false);
    (w as { busy: number }).busy++;
    now += 2;
    expect(await sweepIdle(now)).toBe(false);
    (w as { busy: number }).busy--;
    expect(await sweepIdle(now)).toBe(true);
    await w?.proc.exited;
    expect(isAlive(pid)).toBe(false);
    expect(liveFramesWorker()).toBeNull();
  });

  it("the idle delay can be shortened, and the sweep then runs by itself", async () => {
    framesTimeouts.idleMs = 300;
    await sharpness([at("a.jpg")]);
    const w = liveFramesWorker();
    await w?.proc.exited;
    expect(liveFramesWorker()).toBeNull();
  });

  it("stopping Testimus' helper processes takes the frames worker too", async () => {
    await sharpness([at("a.jpg")]);
    const w = liveFramesWorker();
    await stopAllServers();
    await w?.proc.exited;
    expect(liveFramesWorker()).toBeNull();
  });
});
