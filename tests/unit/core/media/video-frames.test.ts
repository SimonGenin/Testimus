import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exit, RunSpec } from "../../../../src/shared/run/process.ts";

const procs = vi.hoisted(() => ({ run: null as ((spec: RunSpec) => Promise<Exit>) | null }));

vi.mock("../../../../src/shared/run/process.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/shared/run/process.ts")>();
  return { ...real, run: (spec: RunSpec) => (procs.run ? procs.run(spec) : real.run(spec)) };
});

const { resetProbe } = await import("../../../../src/core/claude/status.ts");
const { quietCtx } = await import("../../../../src/core/command.ts");
const { env } = await import("../../../../src/core/env.ts");
const { DEFAULT_SETTINGS, writeSettings } = await import("../../../../src/core/lib/project.ts");
const { candidatesOf, isShaky } = await import("../../../../src/core/lib/video/frames.ts");
const { cancelled, SCAN_FPS, shotFile, videoIo } = await import("../../../../src/core/lib/video/io.ts");
const { findCandidates } = await import("../../../../src/core/lib/video/survey.ts");
const { mockSpawnClaude } = await import("../../../../src/core/mock/claude.ts");
await import("../../../../src/core/mock/claude-media.ts");
const { setupVideoMock } = await import("../../../../src/core/mock/video.ts");
const { call, fixtureCopy } = await import("../registry.ts");

import type { ClaudeSpawn } from "../../../../src/core/env.ts";
import type { Look } from "../../../../src/core/lib/video/io.ts";
import type { DocJson, MediaFile, VideoData } from "../../../../src/core/types.ts";

const realSpawn = env.spawnClaude;
const realIo = { ...videoIo };
const none = () => new AbortController().signal;
let P = "";
let surveys: { stdin: string; crops: string[] }[] = [];

const dir = (id: string) => join(P, "docs", id);
const video = (id: string) => JSON.parse(readFileSync(join(dir(id), "video", "1.json"), "utf8")) as VideoData;
const looked = (id: string) =>
  JSON.parse(readFileSync(join(dir(id), "video", "1", "look.json"), "utf8")) as { slices: { from: number }[] };
const scenes = (duration: number) => Array.from({ length: Math.ceil(duration / 20) }, (_, i) => i * 20);
const exit = (o: Partial<Exit> = {}): Exit => ({
  code: 0,
  stdout: "",
  stderr: "",
  cancelled: false,
  timedOut: false,
  ...o,
});

function made(name: string, duration: number, bytes = 0): string {
  const file = join(P, name);
  writeFileSync(file, JSON.stringify({ duration }).padEnd(bytes, " "));
  return file;
}

// ponytail: every reading of the pictures asked of the (made-up) programs, so a test says which stretches were read
function watched(stopAt?: { changes?: number; shots?: number; stop: AbortController }) {
  const seen = { changes: [] as Look[], shots: [] as { from?: number; ranks: number[] }[] };
  const { changes, shots } = videoIo;
  videoIo.changes = async (file, o, onSeconds, signal) => {
    seen.changes.push(o);
    if (stopAt && stopAt.changes === o.from) {
      stopAt.stop.abort();
      throw cancelled();
    }
    return changes(file, o, onSeconds, signal);
  };
  videoIo.shots = async (file, to, ranks, o, onSeconds, signal) => {
    seen.shots.push({ from: o.from, ranks });
    if (stopAt && stopAt.shots === o.from) {
      stopAt.stop.abort();
      throw cancelled();
    }
    return shots(file, to, ranks, o, onSeconds, signal);
  };
  return {
    ...seen,
    off() {
      Object.assign(videoIo, { changes, shots });
    },
  };
}

beforeEach(() => {
  P = fixtureCopy("video-frames");
  surveys = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = (s: ClaudeSpawn) => {
    const at = /docs\/([^/\s]+)\/video\/1\/mosaic-/.exec(s.stdin)?.[1];
    if (at && s.stdin.startsWith("Testimus video survey run"))
      surveys.push({
        stdin: s.stdin,
        crops: readdirSync(join(dir(at), "video", "1")).filter((n) => n.startsWith("change-")),
      });
    return mockSpawnClaude(s);
  };
  setupVideoMock(mkdtempSync(join(tmpdir(), "testimus-ffmpeg-")));
});

afterEach(() => {
  env.spawnClaude = realSpawn;
  Object.assign(videoIo, realIo);
  procs.run = null;
  resetProbe();
});

describe("the moments worth a frame", () => {
  it("a video filmed by hand gets a frame where the scene changes, a second after, beside the regular floor", () => {
    const moving = Array.from({ length: 60 * SCAN_FPS }, (_, i) => i / SCAN_FPS);
    expect(isShaky(moving, 60)).toBe(true);
    expect(candidatesOf({ changes: moving, duration: 60, said: [] }).every((c) => c.why === "regular")).toBe(true);
    const cut = candidatesOf({ changes: moving, cuts: [32.75], duration: 60, said: [] });
    expect(cut.filter((c) => c.why === "screen")).toEqual([{ at: 33.75, why: "screen" }]);
    expect(cut.filter((c) => c.why === "regular").map((c) => c.at)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
    const capped = candidatesOf({ changes: moving, cuts: [32.75], duration: 60, said: [], cap: 4 });
    expect(capped.some((c) => c.at === 33.75)).toBe(true);
  });

  it("a screen recording keeps its settled screens: a change of scene adds nothing to them", () => {
    const still = candidatesOf({ changes: [0, 30], cuts: [30], duration: 60, said: [] });
    expect(still.filter((c) => c.why === "screen").map((c) => c.at)).toEqual([0, 30]);
  });
});

describe("the pictures of a video, looked through by slices", () => {
  it("finds the candidates of one reading: a change at the border of two slices is neither lost nor found twice", async () => {
    const seen = watched();
    const long = made("long.mp4", 1500);
    await call<DocJson>("docs.add", { file: long, id: "LONG", describeFigures: false, index: false }, P);
    expect(seen.changes.map((o) => [o.from, o.to, o.card])).toEqual([
      [0, 600, false],
      [600, 1200, false],
      [1200, 1500, false],
    ]);
    expect(seen.shots.map((s) => s.from)).toEqual([0, 600, 1200]);
    for (const s of seen.shots)
      expect(s.ranks.every((r) => r >= (s.from ?? 0) * SCAN_FPS && r < ((s.from ?? 0) + 600) * SCAN_FPS)).toBe(true);
    const whole = await videoIo.changes(long, { hdr: false }, () => {}, none());
    const one = candidatesOf({ ...whole, duration: 1500, said: [] }).filter((c) => c.why === "screen");
    expect(one.map((c) => c.at)).toEqual(scenes(1500));
    const found = video("LONG").candidates;
    expect(found.map((c) => c.at)).toEqual(one.map((c) => c.at));
    expect(found.filter((c) => c.at === 600 || c.at === 1200).map((c) => [c.why, !!c.box])).toEqual([
      ["screen", true],
      ["screen", true],
    ]);
    expect(looked("LONG").slices.map((s) => s.from)).toEqual([0, 600, 1200]);
  }, 60_000);

  it("a look cut short goes on at the slice it stopped in, and draws only the frames not there", async () => {
    const stop = new AbortController();
    let seen = watched({ changes: 600, stop });
    const long = made("long.mp4", 1500);
    const input = { file: long, id: "LONG", describeFigures: false, index: false };
    await expect(call("docs.add", input, P, { signal: stop.signal })).rejects.toThrow();
    expect(looked("LONG").slices.map((s) => s.from)).toEqual([0]);
    expect(video("LONG").candidates).toEqual([]);

    seen.off();
    const again = new AbortController();
    seen = watched({ shots: 600, stop: again });
    await expect(
      call("docs.convert", { id: "LONG", describeFigures: false, index: false }, P, { signal: again.signal }),
    ).rejects.toThrow();
    expect(seen.changes.map((o) => o.from)).toEqual([600, 1200]);
    expect(seen.shots.map((s) => s.from)).toEqual([0, 600]);
    const frames = join(dir("LONG"), "video", "1", "frames");
    const first = readdirSync(frames);
    expect(first.length).toBeGreaterThan(30);
    expect(first).toContain("c-000000.jpg");
    expect(video("LONG").candidates).toEqual([]);

    seen.off();
    seen = watched();
    await call("docs.convert", { id: "LONG", describeFigures: false, index: false }, P);
    expect(seen.changes).toEqual([]);
    expect(seen.shots.map((s) => s.from)).toEqual([600, 1200]);
    expect(video("LONG").candidates.map((c) => c.at)).toEqual(scenes(1500));
  }, 60_000);

  it("the same video looked through again is not read twice for its changes; another video or force starts over", async () => {
    const long = made("long.mp4", 1500);
    await call("docs.add", { file: long, id: "LONG", describeFigures: false, index: false }, P);
    expect(existsSync(join(dir("LONG"), "video", "1", "frames", "part"))).toBe(false);
    const f = (JSON.parse(readFileSync(join(dir("LONG"), "doc.json"), "utf8")) as DocJson).source
      .files?.[0] as MediaFile;
    const v = video("LONG");
    const frames = join(dir("LONG"), "video", "1", "frames");
    expect(readdirSync(frames).length).toBe(75);
    const seen = watched();
    const found = await findCandidates(quietCtx(P), P, "LONG", f, v, []);
    expect(seen.changes).toEqual([]);
    expect(seen.shots.length).toBe(3);
    expect(found.candidates.map((c) => c.at)).toEqual(scenes(1500));
    expect(readdirSync(frames).length).toBe(75);
    expect(found.candidates[30].file).toBe(`video/1/frames/c-00${30 * 20 * SCAN_FPS}.jpg`);

    await findCandidates(quietCtx(P), P, "LONG", f, v, [], { force: true });
    expect(seen.changes.map((o) => o.from)).toEqual([0, 600, 1200]);
    await findCandidates(quietCtx(P), P, "LONG", { ...f, sha256: "another" }, v, []);
    expect(seen.changes.length).toBe(6);
  }, 60_000);

  it("asks the graphics card for a heavy video only", async () => {
    const seen = watched();
    const quick = { describeFigures: false, index: false };
    await call("docs.add", { file: made("phone.mp4", 4, 4 * 700_000), id: "PHONE", ...quick }, P);
    await call("docs.add", { file: made("screen.mp4", 4, 4 * 100_000), id: "SCREEN", ...quick }, P);
    expect(seen.changes.map((o) => o.card)).toEqual([true, false]);
    expect(seen.shots.length).toBe(2);
  }, 60_000);
});

describe("the places that changed, at their real size", () => {
  it("every tile shown whose place changed has its crop on disk, named by the tile; the prompt says so in one line", async () => {
    await call("docs.add", { file: made("tour.mp4", 600), id: "TOUR", index: false }, P);
    expect(surveys.length).toBe(1);
    const tiles = Array.from({ length: 29 }, (_, i) => i + 2);
    expect(surveys[0].crops.sort()).toEqual(tiles.map((n) => `change-${n}.jpg`).sort());
    expect(surveys[0].stdin).toContain(
      `Changes, at real size — the change of tile n is docs/TOUR/video/1/change-<n>.jpg, for tiles ${tiles.join(", ")}.`,
    );
    expect(surveys[0].stdin).not.toContain("change-13.jpg");
  }, 60_000);
});

describe("ffmpeg reading a stretch of the pictures", () => {
  const shown = (t: number) => `[Parsed_showinfo_4 @ 0000] n:   0 pts:   0 pts_time:${t} duration: 1 fmt:yuv420p`;
  const scene = (t: number, score = 14.8) => `[scdet @ 0000] lavfi.scd.score: ${score}, lavfi.scd.time: ${t}`;
  const ffmpegOf = (specs: RunSpec[]) => specs.filter((s) => /ffmpeg(\.exe)?$/.test(s.exe));

  it("starts a stretch two frames early, and keeps what changed in the stretch alone, on the video's clock", async () => {
    const specs: RunSpec[] = [];
    procs.run = async (spec) => {
      specs.push(spec);
      return exit({ stderr: [shown(0), scene(0.25), shown(0.5), scene(0.5), shown(100.5), shown(600.5)].join("\n") });
    };
    const seen = await realIo.changes("v.mp4", { hdr: false, from: 600, to: 1200 }, () => {}, none());
    expect(seen).toEqual({ changes: [600, 700], cuts: [600] });
    const args = specs[0].args.join(" ");
    expect(args).toContain("-ss 599.5 -t 601 -i v.mp4");
    expect(args).toContain("fps=4:start_time=0,scale=640:-2,scdet=t=10,mpdecimate,showinfo");
    expect(args).not.toContain("-hwaccel");
    expect(specs[0].priority).toBe("low");

    procs.run = async (spec) => {
      specs.push(spec);
      return exit({ stderr: [shown(0), scene(0.25), shown(12)].join("\n") });
    };
    expect(await realIo.changes("v.mp4", { hdr: false, from: 0, to: 600 }, () => {}, none())).toEqual({
      changes: [0, 12],
      cuts: [],
    });
    expect(specs[1].args.join(" ")).toContain("-t 600.5 -i v.mp4");
    expect(specs[1].args).not.toContain("-ss");
  });

  it("draws the frames of a stretch by their rank, each set in the folder once the reading is over", async () => {
    const out = mkdtempSync(join(tmpdir(), "testimus-shots-"));
    let script = "";
    procs.run = async (spec) => {
      script = readFileSync(spec.args[spec.args.indexOf("-/filter:v") + 1], "utf8");
      const to = dirname(spec.args.at(-1) as string);
      for (const n of [1, 2]) writeFileSync(join(to, `c-0000${n}.jpg`), `frame ${n}`);
      return exit();
    };
    const shots = await realIo.shots(out, out, [2480, 2400], { hdr: false, from: 600, to: 1200 }, () => {}, none());
    expect(script).toContain("select='eq(n\\,2)+eq(n\\,82)',scale=");
    expect(shots).toEqual([
      { at: 600, file: shotFile(out, 2400) },
      { at: 620, file: shotFile(out, 2480) },
    ]);
    expect(readdirSync(out).sort()).toEqual(["c-002400.jpg", "c-002480.jpg"]);
    expect(readFileSync(shotFile(out, 2480), "utf8")).toBe("frame 2");
  });

  it.skipIf(process.platform !== "win32")(
    "decodes on the graphics card, turning a phone's picture upright itself; what the card refuses is read in software, once",
    async () => {
      const specs: RunSpec[] = [];
      let refuse = false;
      procs.run = async (spec) => {
        specs.push(spec);
        if (/ffprobe(\.exe)?$/.test(spec.exe))
          return exit({
            stdout: JSON.stringify({
              streams: [
                {
                  side_data_list: [
                    {
                      displaymatrix: "\n00000000: 0 65536 0\n00000001: -65536 0 0\n00000002: 0 0 1073741824\n",
                      rotation: -90,
                    },
                  ],
                },
              ],
            }),
          });
        if (refuse && spec.args.includes("-hwaccel")) return exit({ code: 1, stderr: "Impossible to convert" });
        return exit({ stderr: shown(0) });
      };
      await realIo.changes("phone.mov", { hdr: true, card: true }, () => {}, none());
      const card = ffmpegOf(specs)[0].args.join(" ");
      expect(card).toContain("-hwaccel d3d11va -hwaccel_output_format d3d11 -i phone.mov");
      expect(card).toContain("fps=4:start_time=0,hwdownload,format=p010le,transpose=clock,scale=640:-2,scdet");

      specs.length = 0;
      refuse = true;
      expect(await realIo.changes("old.avi", { hdr: false, card: true }, () => {}, none())).toEqual({
        changes: [0],
        cuts: [],
      });
      expect(ffmpegOf(specs).map((s) => s.args.includes("-hwaccel"))).toEqual([true, false]);
      specs.length = 0;
      await realIo.changes("old.avi", { hdr: false, card: true }, () => {}, none());
      expect(specs.map((s) => s.args.includes("-hwaccel"))).toEqual([false]);
    },
  );

  it.skipIf(process.platform !== "win32")("leaves a mirrored picture to the software reading", async () => {
    const specs: RunSpec[] = [];
    procs.run = async (spec) => {
      specs.push(spec);
      if (/ffprobe(\.exe)?$/.test(spec.exe))
        return exit({
          stdout: JSON.stringify({
            streams: [
              {
                side_data_list: [
                  {
                    displaymatrix: "\n00000000: -65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824\n",
                    rotation: -180,
                  },
                ],
              },
            ],
          }),
        });
      return exit({ stderr: shown(0) });
    };
    await realIo.changes("mirror.mp4", { hdr: false, card: true }, () => {}, none());
    expect(ffmpegOf(specs).map((s) => s.args.includes("-hwaccel"))).toEqual([false]);
  });
});
