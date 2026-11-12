import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { changedBox, grid } from "../../../../src/core/lib/frames/draw.ts";
import { distinct, sharpness } from "../../../../src/core/lib/frames/frames-process.ts";
import { chapterTrack, subtitles } from "../../../../src/core/lib/media-md.ts";
import { readPerf } from "../../../../src/core/lib/models-perf.ts";
import { readRegistry, updateRegistry } from "../../../../src/core/lib/models-registry.ts";
import { DEFAULT_SETTINGS, readProject, readSettings, writeSettings } from "../../../../src/core/lib/project.ts";
import { speechSpeed } from "../../../../src/core/lib/video/engine.ts";
import { candidatesOf, isShaky, keyFrameBudget } from "../../../../src/core/lib/video/frames.ts";
import { autoTerms, promptFor, promptOf } from "../../../../src/core/lib/video/glossary.ts";
import { heardOf, speechThreads, videoIo } from "../../../../src/core/lib/video/io.ts";
import {
  assembled,
  bySecond,
  cleaned,
  isInvented,
  linesOf,
  spoken,
  withFixes,
  wordsOf,
} from "../../../../src/core/lib/video/lines.ts";
import { jargonRecall, timingError, wordErrorRate } from "../../../../src/core/lib/video/measure.ts";
import { languageCode, languageFor, padded, passagesOf, piecesOf } from "../../../../src/core/lib/video/passages.ts";
import { partsOf, shareOf, strongest } from "../../../../src/core/lib/video/survey.ts";
import { header, readWav, slice } from "../../../../src/core/lib/video/wav.ts";
import { chooseWhisperBackend, whisperDeps } from "../../../../src/core/lib/whisper.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { catalog } from "../../../../src/core/lib/models-catalog.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import type { FigureEntry, SpokenLine, VideoData, VideoFixes } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const real = env.spawnClaude;
const realIo = { ...videoIo };
const realPull = whisperDeps.pull;
let P = "";
let runs: ClaudeSpawn[] = [];

const dir = () => join(P, "docs", V);
const md = () => readFileSync(join(dir(), "doc.md"), "utf8");
const video = () => JSON.parse(readFileSync(join(dir(), "video", "1.json"), "utf8")) as VideoData;
const fixes = () => JSON.parse(readFileSync(join(dir(), "video", "1.fixes.json"), "utf8")) as VideoFixes;
const figures = () => JSON.parse(readFileSync(join(dir(), "figures.json"), "utf8")) as FigureEntry[];
const line = (at: number, text: string, extra: Partial<SpokenLine> = {}): SpokenLine => ({
  at,
  end: at + 3,
  text,
  ...extra,
});

beforeEach(() => {
  P = fixtureCopy("video-speech");
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
  whisperDeps.pull = realPull;
  resetProbe();
});

describe("the sound in pieces and passages", () => {
  it("cuts a long sound every ten minutes in the middle of a silence, or 2 s back where nothing is silent", () => {
    expect(piecesOf(300, [])).toEqual([{ k: 1, from: 0, to: 300, overlap: 0 }]);
    const quiet = piecesOf(1500, [
      { from: 590, to: 592 },
      { from: 1230, to: 1231 },
    ]);
    expect(quiet.map((p) => [p.from, p.to, p.overlap])).toEqual([
      [0, 591, 0],
      [591, 1230.5, 0],
      [1230.5, 1500, 0],
    ]);
    const noisy = piecesOf(1500, []);
    expect(noisy.map((p) => [p.from, p.to, p.overlap])).toEqual([
      [0, 600, 0],
      [598, 1198, 2],
      [1196, 1500, 2],
    ]);
    expect(piecesOf(3600, [], 300, 900).map((p) => [p.from, p.to])).toEqual([[300, 900]]);
  });

  it("joins the stretches of speech less than a second apart into passages of about 10 s, never longer than asked", () => {
    const voices = [
      { from: 0.4, to: 3.1 },
      { from: 3.6, to: 7 },
      { from: 7.5, to: 12 },
      { from: 20, to: 22 },
      { from: 22.4, to: 49 },
    ];
    expect(passagesOf(voices)).toEqual([
      { from: 0.4, to: 7 },
      { from: 7.5, to: 12 },
      { from: 20, to: 22 },
      { from: 22.4, to: 49 },
    ]);
    expect(passagesOf(voices, 28)).toEqual([
      { from: 0.4, to: 12 },
      { from: 20, to: 22 },
      { from: 22.4, to: 49 },
    ]);
    const all = passagesOf(voices);
    expect(padded(all[0], 0, all, 60)).toEqual({ from: 0.2, to: 7.2 });
    expect(padded(all[1], 1, all, 60).from).toBe(7.3);
    expect(padded(all[3], 3, all, 49.1).to).toBe(49.1);
  });

  it("a passage keeps the language detected unless it is doubtful or not expected", () => {
    const d = (language: string, p: number, probabilities: Record<string, number> = {}) => ({
      language,
      p,
      probabilities: { [language]: p, ...probabilities },
    });
    expect(languageFor(d("de", 0.98), { expected: [] })).toEqual({ language: "de", again: false });
    expect(languageFor(d("en", 0.37), { expected: [], neighbour: "de" })).toEqual({ language: "de", again: true });
    expect(languageFor(d("en", 0.37), { expected: [] })).toEqual({ language: "en", again: false });
    expect(languageFor(d("cy", 0.9, { de: 0.05, en: 0.02 }), { expected: ["en", "de"] })).toEqual({
      language: "de",
      again: true,
    });
    expect(languageFor(d("cy", 0.9), { expected: ["EN", "de"], neighbour: "en" })).toEqual({
      language: "en",
      again: true,
    });
    expect(languageFor(d("fr", 0.5, { en: 0.4 }), { expected: ["en", "fr"] })).toEqual({
      language: "fr",
      again: false,
    });
    expect([languageCode("German"), languageCode("fr"), languageCode(" ENGLISH ")]).toEqual(["de", "fr", "en"]);
  });

  it("reads the engine's answer: the language asked or detected, and its pieces of words", () => {
    const answer = {
      detected_language: "german",
      detected_language_probability: 0.98,
      language_probabilities: { de: 0.98, en: 0.01 },
      segments: [{ words: [{ word: " Dre", start: 2.01, end: 2.41, probability: 0.33 }] }],
    };
    expect(heardOf(answer)).toEqual({
      detected: { language: "de", p: 0.98, probabilities: { de: 0.98, en: 0.01 } },
      tokens: [{ text: " Dre", from: 2.01, to: 2.41, p: 0.33 }],
    });
    expect(heardOf({ language: "english" }, "fr").detected).toMatchObject({ language: "fr", p: 1 });
    expect([speechThreads(24), speechThreads(8), speechThreads(4), speechThreads(2)]).toEqual([8, 3, 2, 1]);
  });

  it("a passage is cut from the sound on disk, never the whole sound in memory", () => {
    const file = join(P, "sound.wav");
    const data = Buffer.alloc(16000 * 2 * 10);
    for (let i = 0; i < 160000; i++) data.writeInt16LE(Math.floor(i / 16000), i * 2);
    writeFileSync(file, Buffer.concat([header(16000, data.length), data]));
    const wav = readWav(file);
    expect(wav).toMatchObject({ rate: 16000, bytesPerSecond: 32000, duration: 10 });
    const cut = slice(file, wav, 3, 5.5);
    expect(cut.length).toBe(44 + 2.5 * 32000);
    expect(readWav(file).dataAt).toBe(44);
    expect([cut.readInt16LE(44), cut.readInt16LE(cut.length - 2)]).toEqual([3, 5]);
    expect(slice(file, wav, 9, 20).length).toBe(44 + 32000);
  });
});

describe("the lines of a transcript", () => {
  const at = (s: number) => Math.round(s * 100) / 100;
  const tokens = (text: string, from = 0, p = 0.9, each = 0.3) =>
    text.split(/(?= )/).map((t, i) => ({ text: t, from: at(from + i * each), to: at(from + (i + 1) * each), p }));

  it("joins the engine's pieces into words and cuts a line a sentence, on a pause, at 15 s at most", () => {
    const words = wordsOf([
      { text: " Dre", from: 2, to: 2.4, p: 0.3 },
      { text: "h", from: 2.4, to: 2.5, p: 0.6 },
      { text: "gestelle", from: 2.5, to: 3, p: 0.9 },
      { text: ".", from: 3, to: 3, p: 0.99 },
      { text: "[_BEG_]", from: 3, to: 3, p: 1 },
      { text: " Gut", from: 3.2, to: 3.5, p: 0.8 },
    ]);
    expect(words).toEqual([
      { text: "Drehgestelle.", from: 2, to: 3, p: 0.3 },
      { text: "Gut", from: 3.2, to: 3.5, p: 0.8 },
    ]);
    expect(linesOf(wordsOf(tokens(" One is isolated. Here you can see.")), "en").map((l) => [l.at, l.text])).toEqual([
      [0, "One is isolated."],
      [0.9, "Here you can see."],
    ]);
    const paused = [...tokens(" un terminus"), ...tokens(" la machine de départ", 4)];
    expect(linesOf(wordsOf(paused)).map((l) => l.text)).toEqual(["un terminus", "la machine de départ"]);
    const long = linesOf(wordsOf(tokens(` ${"mot ".repeat(60)}`.trimEnd(), 0, 0.9, 0.5)));
    expect(long.length).toBe(2);
    expect(long[0].end - long[0].at).toBeLessThanOrEqual(15);
    expect(linesOf(wordsOf(tokens(" peut-être ça", 0, 0.4)))[0]).toMatchObject({ unsure: true, p: 0.4 });
    expect(linesOf(wordsOf(tokens(" bien entendu", 0, 0.9)), "fr")[0]).toEqual({
      at: 0,
      end: 0.6,
      text: "bien entendu",
      lang: "fr",
      p: 0.9,
    });
  });

  it("drops what the model invents: a subtitle credit alone, a sentence looped, words all but random", () => {
    expect(isInvented("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true);
    expect(isInvented("Thanks for watching!")).toBe(true);
    expect(isInvented("Merci, on continue.")).toBe(false);
    expect(cleaned([line(1, "Sous-titres réalisés par la communauté d'Amara.org")])).toEqual([]);
    expect(cleaned([line(1, "On valide."), line(5, "Merci d'avoir regardé cette vidéo !")]).length).toBe(2);
    expect(cleaned([line(1, "Ok."), line(4, "ok"), line(7, "Ok."), line(10, "Suite.")])).toEqual([
      { at: 1, end: 10, text: "Ok.", unsure: true },
      line(10, "Suite."),
    ]);
    expect(cleaned([line(1, "zxq", { p: 0.1 }), line(4, "On ouvre.", { p: 0.8 })]).map((l) => l.text)).toEqual([
      "On ouvre.",
    ]);
  });

  it("puts the pieces together: no line heard twice where two pieces overlap, one line a second", () => {
    const a = [line(590, "on continue"), line(597.2, "et là on valide", { end: 599.5 })];
    const b = [line(597.6, "là on valide"), line(601, "voilà"), line(601.6, "c'est fait", { unsure: true })];
    expect(assembled([a, b]).map((l) => [l.at, l.text])).toEqual([
      [590, "on continue"],
      [597.2, "et là on valide"],
      [601, "voilà c'est fait"],
    ]);
    expect(assembled([a, b])[2]).toMatchObject({ unsure: true, end: 604.6 });
    expect(bySecond([line(5.1, "a"), line(5.8, "b", { by: "human" }), line(7, "c")]).map((l) => l.text)).toEqual([
      "a b",
      "c",
    ]);
  });

  it("a range a person corrected is theirs: what a machine hears in it is dropped, whatever it now says", () => {
    const fix = { from: 17, to: 29, heard: "section heure", text: "sectionneur S12", by: "sm", at: "2026-11-10" };
    const heard = [line(2, "bonjour"), line(17, "section heure", { lang: "fr", unsure: true }), line(32, "suite")];
    expect(withFixes(heard, [fix])).toEqual([
      line(2, "bonjour"),
      { at: 17, end: 29, text: "sectionneur S12", lang: "fr", by: "human" },
      line(32, "suite"),
    ]);
    const again = [
      line(2, "bonjour"),
      line(16.4, "le"),
      line(18, "sectionneur"),
      line(24, "esse douze"),
      line(32, "suite"),
    ];
    expect(withFixes(again, [fix]).map((l) => l.text)).toEqual(["bonjour", "le", "sectionneur S12", "suite"]);
    expect(withFixes(heard, [])).toBe(heard);
  });

  it("compares speech on its words alone", () => {
    expect(spoken("Là, on fait « clic droit » — sur l’S12 !")).toBe("là on fait clic droit sur l s12");
    expect(spoken("Sous-station")).toBe(spoken("sous station"));
  });

  it("writes the subtitles and the chapters as WebVTT", () => {
    const lines = [
      line(2, "Bonjour.", { end: 4 }),
      line(4.5, "So, weiter --> jetzt.", { translation: "On continue." }),
    ];
    expect(subtitles(lines, false)).toBe(
      "WEBVTT\n\n00:00:02.000 --> 00:00:04.500\nBonjour.\n\n00:00:04.500 --> 00:00:09.000\nSo, weiter → jetzt.\n",
    );
    expect(subtitles(lines, true)).toContain("On continue.");
    expect(
      chapterTrack(
        [
          { at: 0, title: "Début" },
          { at: 3725, title: "Fin" },
        ],
        4000,
      ),
    ).toBe("WEBVTT\n\n00:00:00.000 --> 01:02:05.000\nDébut\n\n01:02:05.000 --> 01:06:40.000\nFin\n");
  });
});

describe("the glossary given to the engine", () => {
  it("takes from the documents what the engine cannot guess, the most used first", () => {
    const terms = autoTerms(P);
    expect(terms).toEqual(expect.arrayContaining(["TCO", "S12"]));
    expect(terms).not.toContain("NOTE");
    expect(terms.length).toBeLessThanOrEqual(120);
  });

  it("is one sentence within the engine's limit; the end of the passage before follows it", () => {
    expect(promptOf(["PCC", "S12", "PCC", " "], "fr")).toEqual({
      prompt: "Glossaire : PCC, S12.",
      tokens: 9,
      kept: ["PCC", "S12"],
    });
    expect(promptOf([], "en")).toEqual({ prompt: "", tokens: 0, kept: [] });
    const many = promptOf(
      Array.from({ length: 200 }, (_, i) => `TERME${i}`),
      "en",
    );
    expect(many.tokens).toBeLessThanOrEqual(170);
    expect(many.kept.length).toBeGreaterThan(30);
    expect(many.kept[0]).toBe("TERME0");
    expect(promptFor("Glossary: PCC.", "on valide")).toBe("Glossary: PCC. on valide");
    expect(promptFor("", undefined)).toBe("");
    const tail = promptFor("G.", `${"mot ".repeat(80)}fin`);
    expect(tail.length).toBeLessThanOrEqual(2 + 1 + 150);
    expect(tail.endsWith("fin")).toBe(true);
    expect(tail.slice(3).startsWith("mot")).toBe(true);
  });

  it("media.glossary shows it; project.set video writes the team's own, null goes back to the documents'", async () => {
    type G = { terms: string[]; auto: boolean; prompt: string; tokens: number; budget: number };
    const auto = await call<G & { heard: { language: string; seconds: number }[]; languages: unknown[] }>(
      "media.glossary",
      {},
      P,
    );
    expect(auto).toMatchObject({ auto: true, budget: 170 });
    expect(auto.prompt).toBe(`Glossaire : ${auto.terms.join(", ")}.`);
    expect(auto.tokens).toBeLessThanOrEqual(170);
    expect(auto.heard).toEqual([
      { language: "fr", seconds: 120 },
      { language: "de", seconds: 12 },
    ]);
    expect(auto.languages.length).toBeGreaterThan(20);
    await call(
      "project.set",
      {
        video: {
          glossary: ["  Sectionneur  S12 ", "PCC", ""],
          spoken: ["FR", "de", "fr"],
          density: "detailed",
          translate: false,
        },
      },
      P,
    );
    expect(readProject(P).video).toEqual({
      glossary: ["Sectionneur S12", "PCC"],
      spoken: ["fr", "de"],
      density: "detailed",
      translate: false,
    });
    const own = await call<G>("media.glossary", {}, P);
    expect(own).toMatchObject({
      auto: false,
      prompt: "Glossaire : Sectionneur S12, PCC.",
      terms: ["Sectionneur S12", "PCC"],
    });
    await call("project.set", { video: { glossary: null, spoken: [] } }, P);
    expect(readProject(P).video).toEqual({ density: "detailed", translate: false });
  });

  it("a list the engine could not read whole is refused: every term written is sent", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `EQUIPEMENT_${i}`);
    await expect(call("project.set", { video: { glossary: long } }, P)).rejects.toMatchObject({
      code: "glossary-too-long",
    });
    expect(readProject(P).video?.glossary).toBeUndefined();
  });

  it("media.suggestGlossary: Claude writes it from the documents, it is saved as the team's and sent whole", async () => {
    const r = await call<{ ok: boolean; terms: string[] }>("media.suggestGlossary", { ask: "les sous-stations" }, P);
    expect(r.ok).toBe(true);
    expect(r.terms.slice(0, 2)).toEqual(["S12", "Sectionneur"]);
    expect(readProject(P).video?.glossary).toEqual(r.terms);
    const g = await call<{ terms: string[]; auto: boolean; prompt: string }>("media.glossary", {}, P);
    expect(g).toMatchObject({ auto: false, terms: r.terms, prompt: `Glossaire : ${r.terms.join(", ")}.` });
    const sent = runs.find((s) => s.stdin.startsWith("Testimus transcription glossary run"));
    expect(sent?.stdin).toContain("The team asks: « les sous-stations »");
    expect(sent?.stdin).toMatch(/Candidates counted in the documents, most used first: .*S12/);
  });
});

describe("the frames of a video", () => {
  it("takes a frame once the screen has settled, and before a change when it stayed long; a pointer on its way is skipped", () => {
    const changes = [0, 1, 1.25, 1.5, 1.75, 2, 4, 8];
    const c = candidatesOf({ changes, duration: 12, said: [] });
    expect(c.filter((x) => x.why === "screen").map((x) => x.at)).toEqual([0, 2, 4, 8]);
    expect(c.find((x) => x.at === 5)).toMatchObject({ why: "regular" });
    const long = candidatesOf({ changes: [0, 30], duration: 60, said: [{ at: 12, text: "là on clique sur valider" }] });
    expect(long.filter((x) => x.why === "before").map((x) => x.at)).toEqual([29.75]);
    expect(long.filter((x) => x.why === "said").map((x) => x.at)).toEqual([12, 14]);
    expect(isShaky(changes, 12)).toBe(false);
    const moving = Array.from({ length: 200 }, (_, i) => i / 4);
    expect(isShaky(moving, 50)).toBe(true);
    expect(candidatesOf({ changes: moving, duration: 50, said: [] }).every((x) => x.why === "regular")).toBe(true);
  });

  it("past the cap the weakest go first, never the settled screens", () => {
    const changes = Array.from({ length: 300 }, (_, i) => i * 4);
    const c = candidatesOf({ changes, duration: 1200, said: [], cap: 320 });
    expect(c.length).toBeLessThanOrEqual(320);
    expect(c.filter((x) => x.why === "screen").length).toBe(300);
  });

  it("sees a 40 px alarm on a 1280 px screen and says where; the same screen is dropped", async () => {
    const screen = async (file: string, alarm: boolean, pointer?: [number, number]) => {
      const marks = [
        alarm ? '<rect x="1100" y="40" width="40" height="40" fill="#ff0000"/>' : "",
        pointer ? `<rect x="${pointer[0]}" y="${pointer[1]}" width="12" height="18" fill="#ffffff"/>` : "",
      ].join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#0f2a3a"/><rect x="200" y="200" width="300" height="200" fill="#e0b040"/>${marks}</svg>`;
      writeFileSync(file, await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
      return file;
    };
    const plain = await screen(join(P, "a.jpg"), false);
    const same = await screen(join(P, "b.jpg"), false, [600, 500]);
    const alarm = await screen(join(P, "c.jpg"), true);
    expect(changedBox(await grid(plain), await grid(same))).toBeNull();
    const box = changedBox(await grid(plain), await grid(alarm));
    expect(box).toEqual([0.8125, 0, 0.125, 1 / 9]);
    const kept = await distinct([{ file: plain }, { file: same }, { file: alarm }]);
    expect(kept.map((k) => k.file)).toEqual([plain, alarm]);
    expect(kept[1].box).toEqual(box);
    expect((await sharpness([alarm]))[0]).toBeGreaterThan(0);
  });

  it("gives a video as many key frames as its length is worth, shared between its parts", () => {
    expect([keyFrameBudget(160), keyFrameBudget(1800), keyFrameBudget(7200), keyFrameBudget(36000)]).toEqual([
      8, 40, 150, 150,
    ]);
    expect([
      keyFrameBudget(1800, "sober"),
      keyFrameBudget(1800, "detailed"),
      keyFrameBudget(1800, "normal", 12),
    ]).toEqual([20, 64, 12]);
    const parts = partsOf(
      [
        { at: 0, title: "A" },
        { at: 600, title: "B" },
      ],
      1800,
    );
    expect(parts).toEqual([
      { title: "A", from: 0, to: 600 },
      { title: "B", from: 600, to: 1800 },
    ]);
    expect(parts.map((p) => shareOf(p, 1800, 40))).toEqual([13, 27]);
    expect(partsOf([], 700).map((p) => p.title)).toEqual(["00:00 – 05:00", "05:00 – 10:00", "10:00 – 11:40"]);
    expect(
      partsOf(
        Array.from({ length: 30 }, (_, i) => ({ at: i * 60, title: `C${i}` })),
        1800,
      ).length,
    ).toBeLessThanOrEqual(12);
    expect(
      partsOf(
        [
          { at: 0, title: "A" },
          { at: 300, title: "B" },
          { at: 600, title: "C" },
          { at: 1200, title: "D" },
        ],
        1800,
        Array.from({ length: 40 }, (_, i) => ({ at: i * 45 })),
      ),
    ).toEqual([
      { title: "A · B · C", from: 0, to: 1200 },
      { title: "D", from: 1200, to: 1800 },
    ]);
    const cands = [
      { at: 0, file: "a", why: "regular" },
      { at: 5, file: "b", why: "screen" },
      { at: 9, file: "c", why: "said" },
      { at: 12, file: "d", why: "screen" },
    ];
    expect(strongest(cands, 2).map((c) => c.at)).toEqual([5, 12]);
    expect(strongest(cands, 3).map((c) => c.at)).toEqual([5, 9, 12]);
  });
});

describe("what people correct", () => {
  type Fixed = { line?: { text: string; unsure?: boolean; by?: string }; cited: number };

  it("media.fix corrects or confirms a line; it is no longer unsure and its range is the person's", async () => {
    const confirmed = await call<Fixed>("media.fix", { doc: V, at: "01:02", index: false }, P);
    expect(confirmed.line).toMatchObject({ by: "human" });
    expect(confirmed.line?.unsure).toBeUndefined();
    expect(md()).not.toContain("<!-- unsure -->");
    const fixed = await call<Fixed>(
      "media.fix",
      { doc: V, at: "17", text: "  Sur le TCO, on repère   le sectionneur S12. ", index: false },
      P,
    );
    expect(fixed.line?.text).toBe("Sur le TCO, on repère le sectionneur S12.");
    expect(fixes().lines.map((l) => [l.from, l.to, l.heard, l.text])).toEqual([
      [17, 28, expect.stringContaining("Sur le synoptique de traction"), "Sur le TCO, on repère le sectionneur S12."],
      [
        62,
        73,
        expect.stringContaining("On demande l'autorisation"),
        expect.stringContaining("On demande l'autorisation"),
      ],
    ]);
    expect(video().transcript[1].text).toContain("Sur le synoptique de traction");
    expect(md()).toContain("[00:17] Sur le TCO, on repère le sectionneur S12. <!-- t 00:17 -->");
    const shown = await call<{ videos: { unsure: number; fixed: number }[] }>("media.show", { doc: V }, P);
    expect(shown.videos[0]).toMatchObject({ unsure: 0, fixed: 2 });
    await call("media.fix", { doc: V, at: "17", text: "Sur le TCO.", index: false }, P);
    expect(fixes().lines[0]).toMatchObject({
      heard: expect.stringContaining("Sur le synoptique"),
      text: "Sur le TCO.",
    });
    await expect(call("media.fix", { doc: V, at: "00:05", index: false }, P)).rejects.toThrow(
      "No line starts at 00:05",
    );
    await expect(call("media.fix", { doc: V, at: "17", text: "  ", index: false }, P)).rejects.toThrow(
      "cannot be empty",
    );
    const back = await call<Fixed>("media.unfix", { doc: V, at: "01:02", index: false }, P);
    expect(back.line).toMatchObject({ unsure: true });
    await expect(call("media.unfix", { doc: V, at: "01:02", index: false }, P)).rejects.toThrow("No correction");
  });

  it("media.describe makes a key frame's description a person's: Claude never rewrites it", async () => {
    const r = await call<{ anchor: string; description: string; fixed: boolean }>(
      "media.describe",
      { doc: V, at: "01:00", text: "Le menu du sectionneur S12 ne propose que Propriétés.", index: false },
      P,
    );
    expect(r).toMatchObject({ anchor: "frame:01:00", fixed: true });
    expect(md()).toContain("<!-- frame 01:00 -->\nLe menu du sectionneur S12 ne propose que Propriétés.");
    await call("docs.convert", { id: V, force: true, index: false }, P);
    expect(figures().find((f) => f.anchor === "frame:01:00")?.description).toBe(
      "Le menu du sectionneur S12 ne propose que Propriétés.",
    );
    expect(runs.at(-1)?.stdin).not.toContain("- frame:01:00 —");
    const shown = await call<{ videos: { keyFrames: { anchor: string; fixed: boolean }[] }[] }>(
      "media.show",
      { doc: V },
      P,
    );
    expect(shown.videos[0].keyFrames.filter((k) => k.fixed).map((k) => k.anchor)).toEqual(["frame:01:00"]);
    const back = await call<{ fixed: boolean }>("media.describe", { doc: V, at: "01:00", text: "", index: false }, P);
    expect(back.fixed).toBe(false);
    await expect(call("media.describe", { doc: V, at: "00:05", text: "x", index: false }, P)).rejects.toThrow(
      "has no key frame at 00:05",
    );
  });

  it("Claude proposes corrections with their clue and never applies one; a person accepts or refuses", async () => {
    type Proposals = { proposals: { id: string; heard: string; text: string; clue: string; why: string }[] };
    const r = await call<Proposals>("media.propose", { doc: V }, P);
    expect(r.proposals).toEqual([
      {
        id: "62",
        from: 62,
        to: 73,
        heard: expect.stringContaining("refus de manœuvre apparaît"),
        text: expect.stringContaining("refus de manœuvre S12 apparaît"),
        clue: "glossary",
        why: expect.stringContaining("glossaire"),
      },
    ]);
    expect(runs[0].stdin).toContain("- 01:02 · unsure · On demande l'autorisation d'ouverture");
    expect(runs[0].stdin).toContain("    on screen: Propriétés · Autoriser l'ouverture");
    expect(md()).not.toContain("refus de manœuvre S12");
    expect((await call<Proposals>("media.proposals", { doc: V }, P)).proposals.length).toBe(1);
    await call("media.decide", { doc: V, id: "62", accept: true, index: false }, P);
    expect(md()).toContain("refus de manœuvre S12 apparaît dans le bandeau d'alarmes. <!-- t 01:02 -->");
    expect(fixes().lines[0]).toMatchObject({ from: 62, text: expect.stringContaining("S12") });
    expect((await call<Proposals>("media.proposals", { doc: V }, P)).proposals).toEqual([]);
    await call("media.unfix", { doc: V, at: "01:02", index: false }, P);
    await call("media.propose", { doc: V }, P);
    await call("media.decide", { doc: V, id: "62", accept: false, index: false }, P);
    expect(md()).not.toContain("refus de manœuvre S12");
    await expect(call("media.decide", { doc: V, id: "62", accept: true, index: false }, P)).rejects.toThrow(
      "No proposal 62",
    );
  });
});

describe("before and beside a conversion", () => {
  it("media.estimate says what a video will cost on this PC", async () => {
    const file = join(P, "long.mp4");
    writeFileSync(file, JSON.stringify({ duration: 9000, tracks: 2 }));
    const e = await call<Record<string, unknown> & { claude: { runs: number; images: number } }>(
      "media.estimate",
      { file },
      P,
    );
    expect(e).toMatchObject({
      duration: 9000,
      audio: true,
      tracks: 2,
      model: "Whisper large-v3 turbo (8-bit)",
      device: "cpu",
      long: true,
      framesSeconds: 1500,
    });
    expect(e.seconds).toBe((e.speechSeconds as number) + 1500);
    expect(e.claude).toEqual({ runs: 1 + 8 + 8, images: 150 });
    const doc = await call<{ duration: number; measured: boolean }>("media.estimate", { doc: V }, P);
    expect(doc.duration).toBe(160);
    await expect(call("media.estimate", {}, P)).rejects.toThrow("Give a video file");
  });

  it("the speed of a model is what this PC measured, else a careful guess", async () => {
    const turbo = catalog().entries.find((e) => e.id === "whisper-large-v3-turbo-q8");
    const small = catalog().entries.find((e) => e.id === "whisper-small-q8");
    if (!turbo || !small) throw new Error("catalog");
    expect(speechSpeed(turbo, "cpu", 8, [])).toEqual({ speed: 4, measured: false });
    expect(speechSpeed(turbo, "cpu", 3, [])).toEqual({ speed: 1.5, measured: false });
    expect(speechSpeed(small, "gpu", 8, [])).toEqual({ speed: 40, measured: false });
    await call("docs.convert", { id: V, force: true, describeFigures: false, index: false }, P);
    const journal = readPerf().filter((l) => l.op === "speech");
    expect(journal.at(-1)).toMatchObject({
      model: "whisper-large-v3-turbo-q8",
      runtime: "whispercpp",
      device: "cpu",
      items: 160,
    });
    expect(speechSpeed(turbo, "cpu", 8).measured).toBe(journal.at(-1)?.ms !== 0);
  });

  it("media.lighten makes a copy the page plays, kept with the video", async () => {
    const r = await call<{ file: string }>("media.lighten", { doc: V }, P);
    expect(r.file).toBe("video/1/light.mp4");
    expect(existsSync(join(dir(), r.file))).toBe(true);
    expect(video().light).toMatchObject({ file: "video/1/light.mp4", why: "the page could not play the original" });
    const shown = await call<{ videos: { light?: string }[] }>("media.show", { doc: V }, P);
    expect(shown.videos[0].light).toBe("video/1/light.mp4");
  });

  it("a video whose key frames are far apart gets its lighter copy by itself", async () => {
    const sparse = join(P, "sparse.mp4");
    writeFileSync(sparse, JSON.stringify({ duration: 40, keyEvery: 10 }));
    await call("docs.add", { file: sparse, id: "SPARSE", describeFigures: false, index: false }, P);
    const v = JSON.parse(readFileSync(join(P, "docs", "SPARSE", "video", "1.json"), "utf8")) as VideoData;
    expect(v.light?.why).toContain("too far apart");
  });

  it("the models are measured against what a person typed: the project's words, the word errors, the anchors, the speed", async () => {
    expect(wordErrorRate(["a", "b", "c", "d"], ["a", "x", "c"])).toBe(0.5);
    expect(wordErrorRate([], [])).toBe(0);
    expect(jargonRecall(["S12", "PCC", "TCO"], "le S12 au PCC", "le s 12 au pcc")).toEqual({ said: 2, right: 1 });
    expect(timingError([{ at: 10, text: "on ouvre le poste" }], [line(11.2, "on ouvre le poste de commande")])).toBe(
      1.2,
    );
    expect(timingError([{ at: 10, text: "oui" }], [line(10, "oui")])).toBeNull();
    await expect(call("media.measure", { doc: V }, P)).rejects.toThrow("has no reference transcript");
    const text = [
      "[00:02] Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.",
      "00:17 Sur le synoptique de traction, on repère le sectionneur S12 entre les deux sous-stations.",
      "ceci n'est pas une ligne",
    ].join("\n");
    const ref = await call<{ lines: { at: number; text: string }[] }>("media.reference", { doc: V, text }, P);
    expect(ref.lines.map((l) => l.at)).toEqual([2, 17]);
    const before = video();
    const m = await call<{ from: number; to: number; words: number; rows: Record<string, unknown>[] }>(
      "media.measure",
      { doc: V },
      P,
    );
    expect(m).toMatchObject({ from: 0, to: 37, words: 30 });
    expect(m.rows).toEqual([
      {
        model: "whisper-large-v3-turbo-q8",
        label: "Whisper large-v3 turbo (8-bit)",
        device: "cpu",
        jargon: 1,
        terms: expect.any(Number),
        wer: expect.any(Number),
        timing: 0,
        speed: expect.any(Number),
        seconds: expect.any(Number),
        memoryMB: 1240,
        at: expect.any(String),
      },
    ]);
    expect(video()).toEqual(before);
    expect(existsSync(join(P, ".testimus", "measure", `${V}-1-whisper-large-v3-turbo-q8`))).toBe(false);
    expect(existsSync(join(P, "eval", "speech", `${V}-1.json`))).toBe(true);
    expect((await call<{ lines: unknown[] }>("media.reference", { doc: V, text: "" }, P)).lines).toEqual([]);
  });
});

describe("the transcription models of this PC", () => {
  type Speech = {
    engine: { installed: boolean; backend: string | null; advised: string; card: boolean; downloadMB: number };
    ffmpeg: { installed: boolean };
    active: string | null;
    chosen: string | null;
    models: { id: string; installed: boolean; advised: boolean; active: boolean; device: string; speed: number }[];
  };

  it("models.speech says what is here, what fits and what is advised; models.useSpeech chooses", async () => {
    const s = await call<Speech>("models.speech", {}, null);
    expect(s.engine).toMatchObject({ installed: true, backend: "cpu" });
    expect(s.ffmpeg.installed).toBe(true);
    expect(s).toMatchObject({ active: "whisper-large-v3-turbo-q8", chosen: null });
    expect(s.models.map((m) => [m.id, m.installed, m.active])).toEqual([
      ["whisper-large-v3-turbo-q8", true, true],
      ["whisper-large-v3-turbo-q5", false, false],
      ["whisper-small-q8", false, false],
      ["whisper-small-q5", false, false],
    ]);
    expect(s.models.filter((m) => m.advised).length).toBe(1);
    await expect(call("models.useSpeech", { model: "whisper-small-q8" }, null)).rejects.toThrow("is not on this PC");
    await expect(call("models.useSpeech", { model: "bge-m3-q8" }, null)).rejects.toThrow("not a transcription model");
    const used = await call<{ active: string | null }>(
      "models.useSpeech",
      { model: "whisper-large-v3-turbo-q8" },
      null,
    );
    expect(used.active).toBe("whisper-large-v3-turbo-q8");
    expect(readSettings().models.speech).toBe("whisper-large-v3-turbo-q8");
    await call("models.useSpeech", {}, null);
    expect(readSettings().models.speech).toBeUndefined();
  });

  it("models.pullWhisper fetches the build that fits this PC's card and registers it", async () => {
    const asked: string[] = [];
    whisperDeps.pull = async (backend, target) => {
      asked.push(backend);
      return {
        dir: target,
        server: join(target, "whisper-server.exe"),
        vad: join(target, "whisper-vad-speech-segments.exe"),
        vadModel: join(target, "ggml-silero-v6.2.0.bin"),
        build: "b5454",
        backend,
        via: "download",
      };
    };
    updateRegistry((r) => {
      r.dir = join(P, "models");
    });
    const cpu = await call<{ backend: string; build: string }>("models.pullWhisper", { backend: "cpu" }, null);
    expect(cpu).toMatchObject({ backend: "cpu", build: "b5454" });
    expect(readRegistry().whisper?.backend).toBe("cpu");
    await call("models.pullWhisper", {}, null);
    expect(asked.length).toBe(2);
    expect(chooseWhisperBackend(mockMachine("gpu16"))).toBe("cuda");
    expect(chooseWhisperBackend(mockMachine("cpu-only"))).toBe("cpu");
    expect(chooseWhisperBackend(mockMachine("apu"))).toBe("cpu");
    expect(chooseWhisperBackend(null)).toBe("cpu");
    updateRegistry((r) => {
      delete r.dir;
      delete r.runtimesDir;
    });
    await expect(call("models.pullWhisper", {}, null)).rejects.toThrow("No models folder is chosen yet");
  });

  it("a transcription model is checked without being loaded, and never taken for a search model", async () => {
    const v = await call<{ ok: boolean; message: string }>(
      "models.verify",
      { model: "whisper-large-v3-turbo-q8" },
      null,
    );
    expect(v.ok).toBe(false);
    expect(v.message).toContain("is missing or changed (SHA-256)");
    const list = await call<{ model: string; runtime: string }[]>("models.list", {}, null);
    expect(list.find((m) => m.model === "whisper-large-v3-turbo-q8")?.runtime).toBe("whispercpp");
    const cat = await call<{ id: string; kind: string }[]>("models.catalog", { kind: "speech" }, null);
    expect(cat.map((c) => c.id)).toEqual([
      "whisper-large-v3-turbo-q8",
      "whisper-large-v3-turbo-q5",
      "whisper-small-q8",
      "whisper-small-q5",
    ]);
  });
});
