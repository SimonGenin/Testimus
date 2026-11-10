import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { updateRegistry } from "../../../../src/core/lib/models-registry.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { videoIo } from "../../../../src/core/lib/video/io.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import { chunkDoc } from "../../../../src/core/rag/chunk.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import type { DocJson, FigureEntry, VideoData } from "../../../../src/core/types.ts";
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
const kinds = () => runs.map((r) => /^Testimus ([a-z ]+) run/.exec(r.stdin)?.[1]);

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

describe("a video added as a document", () => {
  it("is heard on this PC, translated, surveyed and cut into chapters by one Claude run, its key frames taken and described", async () => {
    const added = await call<DocJson>("docs.add", { file: VIDEO, index: false }, P);
    expect(added.source.type).toBe("video");
    const id = added.id;
    const v = video(id);
    expect(v).toMatchObject({ duration: 160, audio: true, codec: "h264", tracks: [{}] });
    expect(v.transcribed).toMatchObject({
      with: "Whisper large-v3 turbo (8-bit)",
      model: "whisper-large-v3-turbo-q8",
      engine: "whisper.cpp mock cpu",
      device: "cpu",
      spoken: [],
      languages: { fr: 120, de: 12 },
    });
    expect(v.transcribed?.pieces).toBeUndefined();
    expect(v.transcript.map((l) => l.at)).toEqual([2, 17, 32, 47, 62, 77, 92, 107, 122, 137, 152]);
    expect(v.transcript[0]).toEqual({
      at: 2,
      end: 13,
      text: "Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.",
      lang: "fr",
      p: 0.94,
    });
    expect(v.transcript[4]).toMatchObject({ at: 62, unsure: true, p: 0.48 });
    expect(v.transcript[6]).toMatchObject({
      at: 92,
      lang: "de",
      text: "So, dann bitte den Trennschalter S12 wieder schließen.",
      translation: "Bon, refermez maintenant le sectionneur S12, s'il vous plaît.",
    });
    expect(v.translated?.into).toBe("fr");
    expect(v.candidates.map((c) => c.at)).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(v.candidates[1]).toMatchObject({ why: "screen", box: expect.any(Array) });
    expect(v.chapters.map((c) => [c.at, c.title])).toEqual([
      [0, "Ouverture du poste et connexion"],
      [40, "Sélection du sectionneur S12 sur le synoptique"],
      [80, "Menu contextuel et fenêtre Propriétés"],
      [120, "Refus de manœuvre, message d'alarme"],
    ]);
    expect(v.keyFrames.map((k) => [k.at, k.figure])).toEqual([
      [20, "figures/frame-1-20.jpg"],
      [60, "figures/frame-1-60.jpg"],
      [100, "figures/frame-1-100.jpg"],
      [140, "figures/frame-1-140.jpg"],
    ]);
    expect(kinds()).toEqual(["video translation", "video survey", "media"]);
    expect(runs[1].stdin).toContain("To survey: the whole video.");
    expect(runs[1].stdin).toContain("Cut the video into chapters too");
    expect(runs[1].stdin).toContain("all in the same turn");
    expect(runs[1].stdin).toContain(
      `- docs/${id}/video/1/mosaic-1-1.jpg — tiles 1 00:00, 2 00:20, 3 00:40, 4 01:00, 5 01:20, 6 01:40, 7 02:00, 8 02:20`,
    );
    expect(runs[1].stdin).toContain(`- tile 2 00:20 — docs/${id}/video/1/change-2.jpg`);
    expect(runs[1].stdin).toContain("[00:02] Bonjour, on ouvre le poste de commande");
    expect(runs[1].stdin).toContain("[01:32] So, dann bitte den Trennschalter S12 wieder schließen.");
    expect(runs[1].stdin).toContain('```chapters\n[{"at": "00:00", "title": "…"}]\n```\n```video\n{"moments": [');
    expect(runs[2].stdin).toContain("all of them in the same turn");
    expect(runs[2].stdin).toContain("- frame:01:00 —");
    expect(runs[2].stdin).toContain("    part: Sélection du sectionneur S12 sur le synoptique");
    expect(runs[2].stdin).toContain("    said around it: [00:47] La fenêtre Propriétés indique");
    expect(figures(id).map((f) => [f.anchor, f.caption, !!f.description])).toEqual([
      ["frame:00:20", "Image at 00:20", true],
      ["frame:01:00", "Image at 01:00", true],
      ["frame:01:40", "Image at 01:40", true],
      ["frame:02:20", "Image at 02:20", true],
    ]);
    const text = md(id);
    expect(text).toContain("## manoeuvre.mp4 · 02:40 <!-- § video-1 -->");
    expect(text).toContain(
      "[00:32] Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé. <!-- t 00:32 -->",
    );
    expect(text).toContain("dans le bandeau d'alarmes. <!-- t 01:02 --> <!-- unsure -->");
    expect(text).toContain(
      "wieder schließen. <!-- t 01:32 --> <!-- de = Bon, refermez maintenant le sectionneur S12, s'il vous plaît. -->",
    );
    expect(text).toContain(
      "![Image at 01:00](figures/frame-1-60.jpg) <!-- frame 01:00 -->\nLe menu contextuel du sectionneur S12 s'ouvre",
    );
    expect(text).not.toContain("Ouverture du poste et connexion");
    expect(doc(id).converted?.warnings).toEqual([]);
    const left = readdirSync(join(dir(id), "video", "1")).sort();
    expect(left).toEqual(["chapters.vtt", "said.vtt", "sound.json", "transcript", "translated.vtt"]);
    expect(readFileSync(join(dir(id), "video", "1", "said.vtt"), "utf8")).toContain(
      "00:01:32.000 --> 00:01:42.000\nSo, dann bitte den Trennschalter S12 wieder schließen.",
    );
    expect(readFileSync(join(dir(id), "video", "1", "translated.vtt"), "utf8")).toContain(
      "Bon, refermez maintenant le sectionneur S12",
    );
    expect(readFileSync(join(dir(id), "video", "1", "chapters.vtt"), "utf8")).toContain(
      "00:00:40.000 --> 00:01:20.000\nSélection du sectionneur S12 sur le synoptique",
    );
  });

  it("goes on where the last conversion stopped, and starts over with force", async () => {
    const before = video(V);
    await call("docs.convert", { id: V, index: false }, P);
    expect(runs).toEqual([]);
    expect(video(V)).toEqual(before);
    await call("docs.convert", { id: V, force: true, index: false }, P);
    expect(kinds().filter((k) => k === "video survey").length).toBe(1);
    expect(video(V).transcript.length).toBe(11);
  });

  it("a video longer than ten minutes is planned from what is said, then surveyed part by part, chapters sharing a run", async () => {
    const long = join(P, "tour.mp4");
    writeFileSync(long, JSON.stringify({ duration: 900 }));
    const added = await call<DocJson>("docs.add", { file: long, index: false }, P);
    const v = video(added.id);
    expect(v.chapters.map((c) => c.at)).toEqual([0, 225, 450, 675]);
    expect(kinds().filter((k) => k !== "media")).toEqual([
      "video translation",
      "video plan",
      "video survey",
      "video survey",
    ]);
    const plan = runs.find((r) => r.stdin.startsWith("Testimus video plan run"));
    expect(plan?.stdin).toContain("What is said (each line starts with its moment");
    expect(plan?.stdin).toContain("[00:02] Bonjour, on ouvre le poste de commande");
    expect(plan?.stdin).not.toContain("said.txt");
    const surveys = runs.filter((r) => r.stdin.startsWith("Testimus video survey run"));
    expect(surveys[0].stdin).toContain(
      "Part to survey: « Ouverture du poste et connexion · Sélection du sectionneur S12 sur le synoptique · Menu contextuel et fenêtre Propriétés », from 00:00 to 11:15.",
    );
    expect(surveys[0].stdin).not.toContain("Kept just before this part");
    expect(surveys[1].stdin).toContain("Part to survey: « Refus de manœuvre, message d'alarme », from 11:15 to 15:00.");
    expect(surveys[1].stdin).toContain("Kept just before this part:\n- 00:20 — Ouverture du poste et connexion · ");
    expect(surveys[1].stdin).not.toContain("Cut the video into chapters");
    expect(readdirSync(join(dir(added.id), "video", "1"))).not.toContain("said.txt");
  }, 60_000);

  it("a conversion cut short keeps the pieces heard, and the next one hears only what is left", async () => {
    const long = join(P, "long.mp4");
    writeFileSync(long, JSON.stringify({ duration: 1500 }));
    const heard: number[] = [];
    const voices = videoIo.voices;
    let stop: AbortController | null = new AbortController();
    videoIo.voices = async (wav, signal) => {
      heard.push(heard.length + 1);
      if (heard.length === 2) stop?.abort();
      return voices(wav, signal);
    };
    await expect(
      call("docs.add", { file: long, id: "LONG", describeFigures: false, index: false }, P, { signal: stop.signal }),
    ).rejects.toThrow();
    expect(readdirSync(join(dir("LONG"), "video", "1", "transcript"))).toEqual(["1.json"]);
    const partial = video("LONG");
    expect(partial.transcribed?.pieces).toEqual({ done: 1, total: 3 });
    expect(partial.transcript.at(-1)?.at).toBeLessThan(600);
    expect(md("LONG")).toContain("<!-- t 00:02 -->");
    stop = null;
    heard.length = 0;
    await call("docs.convert", { id: "LONG", describeFigures: false, index: false }, P);
    expect(heard.length).toBe(2);
    const whole = video("LONG");
    expect(whole.transcribed?.pieces).toBeUndefined();
    expect(whole.transcript.length).toBe(100);
    expect(new Set(whole.transcript.map((l) => Math.floor(l.at))).size).toBe(100);
    expect(existsSync(join(dir("LONG"), "video", "1", "sound.wav"))).toBe(false);
  });

  it("says what is missing on this PC: without ffmpeg the video is kept, unread; without the engine or a model it has no transcript", async () => {
    updateRegistry((r) => {
      delete r.whisper;
    });
    const one = await call<DocJson>("docs.add", { file: VIDEO, id: "NO_ENGINE", index: false }, P);
    expect(video(one.id).transcript).toEqual([]);
    expect(video(one.id).keyFrames.length).toBe(4);
    expect(doc(one.id).converted?.warnings[0]).toContain("the transcription engine is not on this PC");
    setupVideoMock(mkdtempSync(join(tmpdir(), "testimus-ffmpeg-")));
    updateRegistry((r) => {
      r.installs = [];
    });
    const two = await call<DocJson>("docs.add", { file: VIDEO, id: "NO_MODEL", index: false }, P);
    expect(doc(two.id).converted?.warnings[0]).toContain("no transcription model is on this PC");
    updateRegistry((r) => {
      delete r.ffmpeg;
    });
    const three = await call<DocJson>("docs.add", { file: VIDEO, index: false }, P);
    expect(existsSync(join(dir(three.id), "video", "1.json"))).toBe(false);
    expect(doc(three.id).converted?.warnings[0]).toContain("ffmpeg is not on this PC");
    await expect(call("media.frame", { doc: three.id, at: "00:10" }, P)).rejects.toThrow("ffmpeg is not on this PC");
  });

  it("without Claude, takes the strongest candidates of each part as key frames", async () => {
    const d = await call<DocJson>("docs.add", { file: VIDEO, id: "ALONE", describeFigures: false, index: false }, P);
    expect(runs).toEqual([]);
    const v = video(d.id);
    expect(v.chapters).toEqual([]);
    expect(v.surveyed).toBeUndefined();
    expect(v.keyFrames.map((k) => k.at)).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(existsSync(join(dir(d.id), "video", "1", "frames"))).toBe(true);
  });

  it("is heard as asked: a part of it, its languages, one of its sound tracks — kept on the video", async () => {
    const two = join(P, "two-tracks.mp4");
    writeFileSync(two, JSON.stringify({ duration: 120, tracks: 2 }));
    const asked: unknown[] = [];
    const sound = videoIo.sound;
    videoIo.sound = async (file, out, o, onSeconds, signal) => {
      asked.push(o);
      return sound(file, out, o, onSeconds, signal);
    };
    const d = await call<DocJson>(
      "docs.add",
      {
        file: two,
        id: "PART",
        video: { spoken: ["FR", "de"], track: 1, from: "00:30", to: "01:00" },
        describeFigures: false,
        index: false,
      },
      P,
    );
    expect(d.source.files?.[0]).toMatchObject({ spoken: ["fr", "de"], track: 1, range: { from: 30, to: 60 } });
    expect(asked).toEqual([{ tracks: 2, track: 1, from: 30, to: 60, duration: 120 }]);
    expect(video("PART").transcript.map((l) => l.at)).toEqual([32, 47]);
    expect(video("PART").transcribed?.spoken).toEqual(["fr", "de"]);
    const set = await call<{ range?: unknown; track?: number }>(
      "media.set",
      { doc: "PART", whole: true, allTracks: true },
      P,
    );
    expect(set.range).toBeUndefined();
    expect(set.track).toBeUndefined();
    await expect(call("media.set", { doc: "PART", from: "01:00", to: "00:30" }, P)).rejects.toThrow(
      "ends before it starts",
    );
  });
});

describe("media.transcript and media.frame", () => {
  it("give the timed lines, whole or between two moments, with what is beside each", async () => {
    const all = await call<{ transcribed: boolean; lines: Record<string, unknown>[]; duration: number }>(
      "media.transcript",
      { doc: V },
      P,
    );
    expect(all).toMatchObject({ transcribed: true, duration: 160 });
    expect(all.lines.length).toBe(11);
    const part = await call<{ lines: Record<string, unknown>[] }>(
      "media.transcript",
      { doc: V, from: "00:20", to: "01:35" },
      P,
    );
    expect(part.lines.map((l) => l.anchor)).toEqual(["t:00:17", "t:00:32", "t:00:47", "t:01:02", "t:01:17", "t:01:32"]);
    expect(part.lines[3]).toMatchObject({ unsure: true });
    expect(part.lines[5]).toMatchObject({ lang: "de", translation: expect.stringContaining("refermez") });
  });

  it("draw any moment, or give the key frame when the moment is one", async () => {
    const key = await call<{ file: string; anchor?: string }>("media.frame", { doc: V, at: "01:00" }, P);
    expect(key.anchor).toBe("frame:01:00");
    expect(key.file.replace(/\\/g, "/")).toContain(`docs/${V}/figures/frame-1-60.jpg`);
    const any = await call<{ file: string; at: number; anchor?: string }>("media.frame", { doc: V, at: "47" }, P);
    expect(any.at).toBe(47);
    expect(any.anchor).toBeUndefined();
    expect((await sharp(readFileSync(any.file)).metadata()).width).toBe(1280);
    expect(any.file.replace(/\\/g, "/")).toContain(".testimus/frames/");
    expect(readdirSync(join(any.file, "..")).filter((f) => f.includes(".raw."))).toEqual([]);
    await expect(call("media.frame", { doc: V, at: "03:00" }, P)).rejects.toThrow("No moment 03:00");
  });

  it("media.keep makes any second a key frame, described by who looked at it, citable at once", async () => {
    const kept = await call<{ anchor: string; figure: string; description: string; added: boolean }>(
      "media.keep",
      { doc: V, at: "00:47", description: "La fenêtre Propriétés est ouverte : sans télécommande, état fermé." },
      P,
    );
    expect(kept).toMatchObject({ anchor: "frame:00:47", figure: "figures/frame-1-47.jpg", added: true });
    expect(runs).toEqual([]);
    expect(video(V).keyFrames.find((k) => k.at === 47)).toMatchObject({
      asked: true,
      figure: "figures/frame-1-47.jpg",
    });
    expect(md(V)).toContain(
      "![Image at 00:47](figures/frame-1-47.jpg) <!-- frame 00:47 -->\nLa fenêtre Propriétés est ouverte : sans télécommande, état fermé.",
    );
    const again = await call<{ added: boolean; description: string }>("media.keep", { doc: V, at: "47" }, P);
    expect(again).toMatchObject({ added: false, description: kept.description });
    const read = await call<{ description: string }>("media.keep", { doc: V, at: "02:00" }, P);
    expect(kinds()).toEqual(["media"]);
    expect(read.description).not.toBe("");
    await call("docs.convert", { id: V, force: true, index: false }, P);
    expect(video(V).keyFrames.map((k) => k.at)).toEqual([20, 47, 60, 100, 120, 140]);
  });
});

describe("a second video in the document", () => {
  it("is numbered after the files, anchored by its number, and leaves the first video's anchors alone", async () => {
    const second = join(P, "second.mp4");
    writeFileSync(second, JSON.stringify({ duration: 30 }));
    const r = await call<{ added: number[]; type: string; rejected: { code: string }[] }>(
      "media.add",
      { doc: V, files: [{ path: second }, { path: VIDEO }], describeFigures: false, index: false },
      P,
    );
    expect(r.added).toEqual([2]);
    expect(r.rejected.map((x) => x.code)).toEqual(["duplicate"]);
    expect(r.type).toBe("mixed");
    const text = md(V);
    expect(text).toContain("## second.mp4 · 00:30 <!-- § video-2 -->");
    expect(text).toContain("<!-- t 2/00:02 -->");
    expect(text).toContain("<!-- t 00:02 -->");
    const lines = await call<{ video: number; lines: { anchor: string }[] }>(
      "media.transcript",
      { doc: V, video: 2 },
      P,
    );
    expect(lines.lines.map((l) => l.anchor)).toEqual(["t:2/00:02", "t:2/00:17"]);
  });
});

describe("the index of a video", () => {
  it("has a chunk per key frame, with its description, and passages of whole lines with their translation", async () => {
    const chunks = chunkDoc(doc(V), md(V), figures(V));
    expect(chunks.map((c) => c.kind).sort()).toEqual(["frame", "frame", "frame", "frame", "transcript"]);
    const said = chunks.find((c) => c.kind === "transcript");
    expect(said?.anchor).toBe("t:00:02");
    expect(said?.text.split("\n").filter((l) => l.startsWith("[")).length).toBe(11);
    expect(said?.text).toContain("  = Bon, refermez maintenant le sectionneur S12, s'il vous plaît.");
    expect(said?.text).not.toContain("unsure");
    const frame = chunks.find((c) => c.anchor === "frame:01:00");
    expect(frame?.text).toContain("Le menu contextuel du sectionneur S12 s'ouvre");
    expect(chunks.some((c) => c.kind === "section")).toBe(false);
    await indexProject(P, quietCtx(P));
    const hits = await call<{ docId: string; anchor: string }[]>(
      "rag.search",
      { query: "refermez maintenant le sectionneur", kinds: ["transcript"], k: 5 },
      P,
    );
    expect(hits.map((h) => `${h.docId}#${h.anchor}`)).toContain(`${V}#t:00:02`);
  });

  it("rag.passage reads a moment by time: the line being said then, a range with its key frames, what is seen", async () => {
    const mid = await call<{ text: string; anchor: string }>("rag.passage", { ref: `${V}#t:00:40` }, P);
    expect(mid.text.split("\n")[0]).toBe(
      "[00:32] Là on fait clic droit sur le sectionneur, et on voit que seul Propriétés est proposé.",
    );
    const range = await call<{ text: string; figures: { anchor: string }[] }>(
      "rag.passage",
      { ref: `${V}#t:00:47..01:20` },
      P,
    );
    expect(
      range.text
        .split("\n")
        .filter((l) => l.startsWith("["))
        .map((l) => l.slice(0, 7)),
    ).toEqual(["[00:47]", "[01:02]", "[01:17]"]);
    expect(range.figures.map((f) => f.anchor)).toEqual(["frame:01:00"]);
    const seen = await call<{ text: string; figures: { anchor: string }[] }>(
      "rag.passage",
      { ref: `${V}#v:00:55..01:45` },
      P,
    );
    expect(seen.figures.map((f) => f.anchor)).toEqual(["frame:01:00", "frame:01:40"]);
    expect(seen.text).toContain("Le menu contextuel du sectionneur S12 s'ouvre");
    const german = await call<{ text: string }>("rag.passage", { ref: `${V}#t:01:32` }, P);
    expect(german.text).toContain("  = Bon, refermez maintenant le sectionneur S12");
    await expect(call("rag.passage", { ref: `${V}#t:3/00:10` }, P)).rejects.toThrow("has no anchor");
  });
});
