import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { videoIo } from "../../../../src/core/lib/video/io.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import type { CheckFile, DocJson, FigureEntry, VideoData } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const T = "LFRPS12-1398";
const real = env.spawnClaude;
const realIo = { ...videoIo };
let P = "";
let runs: ClaudeSpawn[] = [];

const dir = (id: string) => join(P, "docs", id);
const video = (id: string, n = 1) => JSON.parse(readFileSync(join(dir(id), "video", `${n}.json`), "utf8")) as VideoData;
const figures = (id: string) => JSON.parse(readFileSync(join(dir(id), "figures.json"), "utf8")) as FigureEntry[];
const md = (id: string) => readFileSync(join(dir(id), "doc.md"), "utf8");
const testMd = () => readFileSync(join(P, "tests", T, "test.md"), "utf8");
const check = () => JSON.parse(readFileSync(join(P, "tests", T, "check.json"), "utf8")) as CheckFile;
const kinds = () => runs.map((r) => /^Testimus ([a-z ]+) run/.exec(r.stdin)?.[1]);

function cite(lines: string[]): void {
  const text = testMd();
  const at = text.indexOf("### Sources");
  const end = text.indexOf("\n", text.indexOf("\n- ", at) + 1);
  writeFileSync(join(P, "tests", T, "test.md"), `${text.slice(0, end)}\n${lines.join("\n")}${text.slice(end)}`);
}

beforeEach(() => {
  P = fixtureCopy("video-kept");
  runs = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = (s) => {
    if (!s.args.includes("--version")) runs.push(s);
    return mockSpawnClaude(s);
  };
  setupVideoMock(mkdtempSync(join(tmpdir(), "testimus-ffmpeg-")));
});

afterEach(() => {
  env.spawnClaude = real;
  Object.assign(videoIo, realIo);
  resetProbe();
});

describe("a recording of sound alone", () => {
  it("is a video document without a picture: heard, cut into chapters, cited to the second, with no frame", async () => {
    const memo = join(P, "reunion.mp3");
    writeFileSync(memo, JSON.stringify({ duration: 130 }));
    const added = await call<DocJson>("docs.add", { file: memo, index: false }, P);
    expect(added.source.type).toBe("video");
    const v = video(added.id);
    expect(v).toMatchObject({ sound: true, duration: 130, audio: true, candidates: [], keyFrames: [] });
    expect(v.width).toBeUndefined();
    expect(v.transcript.length).toBeGreaterThan(0);
    expect(v.chapters.length).toBeGreaterThan(0);
    expect(kinds()).toEqual(["video translation", "video plan"]);
    expect(md(added.id)).toContain("<!-- t 00:02 -->");
    expect(md(added.id)).not.toContain("<!-- frame");
    expect(added.converted?.warnings).toEqual([]);
    const shown = await call<{ videos: { sound: boolean; lines: number }[] }>("media.show", { doc: added.id }, P);
    expect(shown.videos[0]).toMatchObject({ sound: true });
    await expect(call("media.frame", { doc: added.id, at: "00:10" }, P)).rejects.toMatchObject({ code: "no-picture" });
    await expect(call("media.keep", { doc: added.id, at: "00:10" }, P)).rejects.toMatchObject({ code: "no-picture" });
    const e = await call<{ framesSeconds: number; claude: { runs: number; images: number } }>(
      "media.estimate",
      { doc: added.id },
      P,
    );
    expect(e).toMatchObject({ framesSeconds: 0, claude: { runs: 1, images: 0 } });
  });

  it("is told apart from a file with neither picture nor sound, and a HEIC photo still waits", async () => {
    const r = await call<{ rejected: { name: string; code: string }[] }>(
      "media.add",
      { doc: V, files: [{ name: "IMG_1.heic", dataBase64: "AAAA" }], index: false },
      P,
    );
    expect(r.rejected).toEqual([expect.objectContaining({ name: "IMG_1.heic", code: "later" })]);
  });
});

describe("the room the project's videos may take", () => {
  it("a video that would pass the cap is refused when it comes in, and the estimate says so before", async () => {
    const big = join(P, "essai.mp4");
    writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 1));
    await call("project.set", { video: { diskCapGB: 0.002 } }, P);
    const e = await call<{ disk: { usedMB: number; capMB?: number; over: boolean } }>(
      "media.estimate",
      { file: big },
      P,
    );
    expect(e.disk).toMatchObject({ capMB: 2, over: true });
    await expect(call("docs.add", { file: big, index: false }, P)).rejects.toThrow(
      /of the 2 MB the project allows them/,
    );
    expect(existsSync(join(P, "docs", "essai", "files", "essai.mp4"))).toBe(false);
    await call("project.set", { video: { diskCapGB: 0 } }, P);
    const free = await call<{ disk: { capMB?: number; over: boolean } }>("media.estimate", { file: big }, P);
    expect(free.disk.capMB).toBeUndefined();
    expect(free.disk.over).toBe(false);
    const added = await call<DocJson>("docs.add", { file: big, convert: false, index: false }, P);
    expect(added.source.type).toBe("video");
  });
});

describe("key frames described again", () => {
  const MENU = "Le menu contextuel du sectionneur S12 s'ouvre";
  const VIEW = "Le synoptique de traction est affiché";

  it("need no report when every quote of what is seen still holds", async () => {
    cite([`- ${V}#v:00:50..01:10 "${MENU}"`, `- ${V}#v:00:10..00:30 "${VIEW}"`]);
    await call("docs.describeFigures", { docId: V, force: true }, P);
    expect(video(V).seenBefore).toBeUndefined();
    expect((await call<{ report: unknown }>("media.report", { doc: V }, P)).report).toBeNull();
  });

  it("keep what was written before and report the quotes that no longer hold; applied, the test is told its source is missing", async () => {
    cite([`- ${V}#v:00:50..01:10 "${MENU}"`, `- ${V}#v:00:10..00:30 "${VIEW}"`]);
    await call("docs.describeFigures", { docId: V, anchors: ["frame:01:00"], force: true }, P);
    expect(figures(V).find((f) => f.anchor === "frame:01:00")?.description).toContain(VIEW);
    expect(md(V)).not.toContain(MENU);
    expect(video(V).seenBefore?.frames).toEqual([{ at: 60, text: expect.stringContaining(MENU) }]);
    const { report } = await call<{ report: { holds: number; lost: number; rows: Record<string, unknown>[] } | null }>(
      "media.report",
      { doc: V },
      P,
    );
    expect(report).toMatchObject({ holds: 1, lost: 1 });
    expect(report?.rows.find((r) => r.state === "lost")).toMatchObject({
      from: `${V}#v:00:50..01:10`,
      quote: MENU,
      nearest: { anchor: "frame:01:00", text: expect.stringContaining(VIEW) },
    });
    const applied = await call<{ lost: number; undone: boolean }>("media.applyReport", { doc: V, index: false }, P);
    expect(applied).toMatchObject({ lost: 1, undone: false });
    expect(video(V).seenBefore).toBeUndefined();
    const lost = check().findings.find((f) => f.kind === "source-missing");
    expect(lost?.message).toContain("The video was heard or described again since this source was written.");
  });

  it("can be undone: the descriptions before are put back", async () => {
    cite([`- ${V}#v:00:50..01:10 "${MENU}"`]);
    await call("docs.describeFigures", { docId: V, anchors: ["frame:01:00"], force: true }, P);
    const r = await call<{ undone: boolean }>("media.applyReport", { doc: V, undo: true, index: false }, P);
    expect(r.undone).toBe(true);
    expect(figures(V).find((f) => f.anchor === "frame:01:00")?.description).toContain(MENU);
    expect(md(V)).toContain(MENU);
    expect(video(V).seenBefore).toBeUndefined();
  });
});
