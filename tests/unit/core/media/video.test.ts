import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SURVEY_MARKER, SURVEY_TAG } from "../../../../src/core/claude/media.ts";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { loadCorpus, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { dHash, distance, distinct } from "../../../../src/core/lib/video-frames.ts";
import { videoIo } from "../../../../src/core/lib/video-io.ts";
import { mockSpawnClaude, mockStream } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import { clock, momentId, momentOf, parseAnchor } from "../../../../src/core/rag/anchors.ts";
import { chunkDoc } from "../../../../src/core/rag/chunk.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import type { DocJson, FigureEntry, Source, Test, VideoData } from "../../../../src/core/types.ts";
import { call, FIXTURE, fixtureCopy } from "../registry.ts";

const VIDEO = join(FIXTURE, "docs", "Manoeuvre_d_un_sectionneur_au_PCC", "files", "manoeuvre.mp4");
const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const real = env.spawnClaude;
const realIo = { ...videoIo };
let P = "";
let runs: ClaudeSpawn[] = [];

const dir = (id: string) => join(P, "docs", id);
const md = (id: string) => readFileSync(join(dir(id), "doc.md"), "utf8");
const doc = (id: string) => JSON.parse(readFileSync(join(dir(id), "doc.json"), "utf8")) as DocJson;
const video = (id: string, n = 1) => JSON.parse(readFileSync(join(dir(id), "video", `${n}.json`), "utf8")) as VideoData;
const figures = (id: string) => JSON.parse(readFileSync(join(dir(id), "figures.json"), "utf8")) as FigureEntry[];

beforeEach(() => {
  P = fixtureCopy("video");
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

describe("anchors of a moment", () => {
  it("write mm:ss, h:mm:ss past an hour, and the video's number when it is not file 1", () => {
    expect([clock(0), clock(270.9), clock(3725)]).toEqual(["00:00", "04:30", "1:02:05"]);
    expect([momentId(1, 270), momentId(3, 270)]).toEqual(["04:30", "3/04:30"]);
    expect(momentOf("3/04:30-2")).toEqual({ n: 3, at: 270 });
    expect(momentOf("1:02:05")).toEqual({ n: 1, at: 3725 });
    expect(parseAnchor("DOC#t:04:30")).toEqual({ kind: "t", id: "04:30" });
    expect(parseAnchor("frame 04:30")).toEqual({ kind: "frame", id: "04:30" });
    expect(parseAnchor("img:3")).toEqual({ kind: "img", id: "3" });
  });
});

describe("a video added as a document", () => {
  it("is read on this PC — length, timed transcript, frames — surveyed by Claude, its key frames taken and read", async () => {
    const added = await call<DocJson>("docs.add", { file: VIDEO, index: false }, P);
    expect(added.source.type).toBe("video");
    const id = added.id;
    const v = video(id);
    expect(v.duration).toBe(160);
    expect(v.transcribed?.with).toBe("Whisper small (mock)");
    expect(v.transcript[0]).toEqual({
      at: 2,
      end: 14,
      text: "Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.",
    });
    expect(v.candidates.map((c) => c.at)).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(v.chapters.map((c) => [c.at, c.title])).toEqual([
      [0, "Ouverture du poste et connexion"],
      [40, "Sélection du sectionneur S12 sur le synoptique"],
      [80, "Menu contextuel et fenêtre Propriétés"],
      [120, "Refus de manœuvre, message d'alarme"],
    ]);
    expect(v.keyFrames.map((k) => [k.at, k.figure])).toEqual([
      [20, "figures/frame-1-20.jpg"],
      [80, "figures/frame-1-80.jpg"],
      [140, "figures/frame-1-140.jpg"],
    ]);
    expect(runs.map((r) => r.stdin.split("\n")[0])).toEqual([
      `Testimus video survey run for the video « manoeuvre.mp4 » (02:40) of the document ${id} manoeuvre.`,
      `Testimus media run for the document ${id} manoeuvre.`,
    ]);
    expect(runs[0].stdin).toContain(`- docs/${id}/video/1/mosaic-1.jpg — tiles 1 00:00, 2 00:20,`);
    expect(runs[0].stdin).toContain("[00:32] Là on fait clic droit sur le sectionneur");
    expect(figures(id).map((f) => [f.anchor, f.caption, !!f.description])).toEqual([
      ["frame:00:20", "Image at 00:20", true],
      ["frame:01:20", "Image at 01:20", true],
      ["frame:02:20", "Image at 02:20", true],
    ]);
    const text = md(id);
    expect(text).toContain("## manoeuvre.mp4 · 02:40 <!-- § video-1 -->");
    expect(text).toContain(
      "[00:32] Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé. <!-- t 00:32 -->",
    );
    expect(text).toContain("![Image at 01:20](figures/frame-1-80.jpg) <!-- frame 01:20 -->");
    expect(text).not.toContain("Ouverture du poste et connexion");
    expect(doc(id).converted?.warnings).toEqual([]);
  });

  it("goes on where the last conversion stopped, and starts over with force", async () => {
    const before = video(V);
    await call("docs.convert", { id: V, index: false }, P);
    expect(runs).toEqual([]);
    expect(video(V)).toEqual(before);
    await call("docs.convert", { id: V, force: true, index: false }, P);
    expect(runs.length).toBe(2);
  });

  it("says what is missing on this PC: without ffmpeg the video is kept, unread; without Whisper it has no transcript", async () => {
    videoIo.transcribe = async () => null;
    const one = await call<DocJson>("docs.add", { file: VIDEO, id: "NO_SPEECH", index: false }, P);
    expect(video(one.id).transcript).toEqual([]);
    expect(doc(one.id).converted?.warnings[0]).toContain("no speech model on this PC");
    const { updateRegistry } = await import("../../../../src/core/lib/models-registry.ts");
    updateRegistry((r) => {
      delete r.ffmpeg;
    });
    const two = await call<DocJson>("docs.add", { file: VIDEO, index: false }, P);
    expect(existsSync(join(dir(two.id), "video", "1.json"))).toBe(false);
    expect(doc(two.id).converted?.warnings[0]).toContain("ffmpeg is not on this PC");
    await expect(call("media.frame", { doc: two.id, at: "00:10" }, P)).rejects.toThrow("ffmpeg is not on this PC");
  });
});

describe("media.transcript and media.frame", () => {
  it("give the timed lines between two moments, each with its quotable anchor", async () => {
    const r = await call<{ lines: { anchor: string; text: string }[]; duration: number }>(
      "media.transcript",
      { doc: V, from: "00:20", to: "01:00" },
      P,
    );
    expect(r.duration).toBe(160);
    expect(r.lines.map((l) => l.anchor)).toEqual(["t:00:17", "t:00:32", "t:00:47"]);
  });

  it("draw a key frame from its picture and another moment from the video, refusing a moment past the end", async () => {
    const key = await call<{ file: string; anchor?: string }>("media.frame", { doc: V, at: "01:20" }, P);
    expect(key.anchor).toBe("frame:01:20");
    expect(key.file).toBe(join(dir(V), "figures", "frame-1-80.jpg"));
    const other = await call<{ file: string; at: number; anchor?: string }>("media.frame", { doc: V, at: "47" }, P);
    expect(other.at).toBe(47);
    expect(other.anchor).toBeUndefined();
    expect((await sharp(other.file).metadata()).width).toBe(1280);
    expect(other.file.startsWith(join(P, ".testimus", "frames"))).toBe(true);
    const leftovers = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? leftovers(join(d, e.name)) : /^at-|\.raw\./.test(e.name) ? [e.name] : [],
      );
    expect([...leftovers(dir(V)), ...leftovers(join(P, ".testimus", "frames"))]).toEqual([]);
    await expect(call("media.frame", { doc: V, at: "03:00" }, P)).rejects.toThrow("No moment 03:00");
  });
});

describe("a second video in a document", () => {
  it("carries its number in its anchors, and the first keeps its own", async () => {
    const before = md(V);
    const same = await call<{ rejected: { code: string }[] }>(
      "media.add",
      { doc: V, files: [{ path: VIDEO }], index: false },
      P,
    );
    expect(same.rejected.map((x) => x.code)).toEqual(["duplicate"]);
    expect(doc(V).source.files?.length).toBe(1);
    const other = join(mkdtempSync(join(tmpdir(), "testimus-v2-")), "second.mp4");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(other, JSON.stringify({ duration: 30, audio: true }));
    await call("media.add", { doc: V, files: [{ path: other }], index: false }, P);
    const d = doc(V);
    expect(d.source.type).toBe("mixed");
    expect(d.source.files?.map((f) => [f.n, f.kind])).toEqual([
      [1, "video"],
      [2, "video"],
    ]);
    const after = md(V);
    for (const l of before.split("\n").filter((x) => x.includes("<!-- t ") || x.includes("<!-- frame ")))
      expect(after).toContain(l);
    expect(after).toContain("## second.mp4 · 00:30 <!-- § video-2 -->");
    expect(after).toContain("<!-- t 2/00:02 -->");
    const r = await call<{ lines: { anchor: string }[] }>("media.transcript", { doc: V, video: 2 }, P);
    expect(r.lines[0].anchor).toBe("t:2/00:02");
  });
});

describe("the mechanical check at a transcript line", () => {
  const step = (src: Source) =>
    ({
      summary: "s",
      steps: [{ fields: { Action: "Clic droit.", "Expected Result": "Seul Propriétés." }, sources: [src], images: [] }],
    }) as unknown as Test;
  const QUOTE = "on voit que seul Propriétés est proposé";

  it("finds what was said at its line, tells another line, and flags an expected result backed by it alone", () => {
    const corpus = loadCorpus(P);
    const kinds = (a: string) =>
      mechanicalFindings(step({ docId: V, anchor: a, quote: QUOTE }), corpus).map((f) => f.kind);
    expect(kinds("t:00:32")).toEqual(["observed-only"]);
    expect(kinds("t:00:47")).toEqual(["quote-not-at-anchor", "observed-only"]);
    const where = mechanicalFindings(step({ docId: V, anchor: "t:00:47", quote: QUOTE }), corpus)[0];
    expect(where.message).toContain("it is under t:00:32");
    expect(kinds("frame:01:20")).toContain("quote-not-at-anchor");
  });
});

describe("the index", () => {
  it("cuts the transcript into passages of whole lines and makes a chunk per key frame", () => {
    const chunks = chunkDoc({ ...doc(V), id: V }, md(V), figures(V));
    expect(chunks.map((c) => c.kind)).toEqual(["frame", "frame", "frame", "transcript"]);
    const t = chunks.find((c) => c.kind === "transcript");
    expect(t?.anchor).toBe("t:00:02");
    expect(t?.text.split("\n")).toHaveLength(11);
    expect(t?.text.split("\n")[2]).toBe(
      "[00:32] Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé.",
    );
  });

  it("keeps one key frame a second: two moments Claude gives in the same second are one, past the end is the end", async () => {
    env.spawnClaude = (s) => {
      if (!s.stdin.startsWith(SURVEY_MARKER)) return mockSpawnClaude(s);
      const moments = [
        { at: "00:42", why: "Le menu" },
        { at: 42.6, why: "L'alarme" },
        { at: "09:59", why: "La fin" },
      ];
      const reply = [`\`\`\`${SURVEY_TAG}`, JSON.stringify({ chapters: [], moments }), "```"].join("\n");
      return mockStream(s, { texts: [reply], result: reply, delayMs: 5 });
    };
    const added = await call<DocJson>("docs.add", { file: VIDEO, index: false }, P);
    expect(video(added.id).keyFrames.map((k) => [k.at, k.why, k.figure])).toEqual([
      [42, "Le menu", "figures/frame-1-42.jpg"],
      [160, "La fin", "figures/frame-1-160.jpg"],
    ]);
    const ids = chunkDoc({ ...doc(added.id), id: added.id }, md(added.id), figures(added.id)).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("indexes a document whose doc.md writes one anchor twice, with a warning, and the others still", async () => {
    writeFileSync(join(dir(V), "doc.md"), `${md(V)}\n![Image at 01:20](figures/frame-1-80.jpg) <!-- frame 01:20 -->\n`);
    const warned: string[] = [];
    const ctx = { ...quietCtx(P), log: (_: string, m: string) => void warned.push(m) };
    const r = await indexProject(P, ctx, { model: null });
    expect(r.docs.find((d) => d.docId === V)?.status).toBe("indexed");
    expect(r.docs.length).toBeGreaterThan(1);
    expect(warned).toContain(
      `${V}: the anchor frame:01:20 is written twice in doc.md; its second passage is not indexed.`,
    );
    const p = await call<{ text: string }>("rag.passage", { ref: `${V}#frame:01:20` }, P);
    expect(p.text).toContain("Image at 01:20");
  });

  it("reads a transcript passage from its line on", async () => {
    const p = await call<{ text: string }>("rag.passage", { ref: `${V}#t:02:17` }, P);
    expect(p.text.split("\n")).toEqual([
      "[02:17] La fenêtre Propriétés indique un sectionneur sans télécommande, à l'état fermé.",
      "[02:32] On demande l'autorisation d'ouverture, le message de refus de manœuvre apparaît dans le bandeau d'alarmes.",
    ]);
  });
});

describe("near-duplicate frames", () => {
  it("are dropped by their difference hash: a still screen is one frame", async () => {
    const shot = (x: number) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="100%" height="100%" fill="#123"/><rect x="${x}" y="10" width="30" height="60" fill="#fc0"/></svg>`,
        ),
      )
        .jpeg()
        .toBuffer();
    const d = mkdtempSync(join(tmpdir(), "testimus-dhash-"));
    const { writeFileSync } = await import("node:fs");
    const files = [10, 10, 11, 100].map((x, i) => {
      const f = join(d, `${i}.jpg`);
      return { f, x };
    });
    for (const { f, x } of files) writeFileSync(f, await shot(x));
    expect(distance(await dHash(files[0].f), await dHash(files[1].f))).toBe(0);
    const kept = await distinct(files.map((x, i) => ({ file: x.f, at: i * 5 })));
    expect(kept.map((k) => k.at)).toEqual([0, 15]);
  });
});
