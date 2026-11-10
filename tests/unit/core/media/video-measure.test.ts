import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserError } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { catalog } from "../../../../src/core/lib/models-catalog.ts";
import { dropInstall, putInstall, updateRegistry } from "../../../../src/core/lib/models-registry.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { videoIo } from "../../../../src/core/lib/video/io.ts";
import {
  type Measure,
  type MeasureReport,
  measureIo,
  type Verdict,
  verdictsOf,
  wordErrorRate,
} from "../../../../src/core/lib/video/measure.ts";
import { comparable } from "../../../../src/core/lib/video/numbers.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import { clock } from "../../../../src/core/rag/anchors.ts";
import type { ModelsRegistry, VideoData } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const Q8 = "whisper-large-v3-turbo-q8";
const Q5 = "whisper-large-v3-turbo-q5";
const FIRST = "[00:02] Bonjour, on ouvre le poste de commande et on se connecte avec le profil régulateur.";
const SECOND = "[00:17] Sur le synoptique de traction, on repère le sectionneur S12 entre les deux sous-stations.";
const realSpawn = env.spawnClaude;
const realIo = { ...videoIo };
const realMeasureIo = { ...measureIo };
let P = "";
let root = "";
let watched: string[] = [];
let stopped = 0;
let denoisedTo: { src: string; to: number }[] = [];

type Row = Measure;
type Measured = Omit<MeasureReport, "verdicts"> & { verdicts: Verdict[] };
type Measures = {
  videos: {
    doc: string;
    video: number;
    name: string;
    language?: string;
    words: number;
    stale: boolean;
    measures: (Omit<Row, "jargon" | "timing"> & { jargon?: number; timing?: number })[];
  }[];
  byLanguage: {
    language: string;
    model: string;
    videos: number;
    references: number;
    enough: boolean;
    words: number;
    wer: number;
    jargon?: number;
    terms: number;
  }[];
  notes: string[];
};

const saved = (doc = V) => join(P, "eval", "speech", `${doc}-1.json`);
const report = (doc = V) => JSON.parse(readFileSync(saved(doc), "utf8")) as MeasureReport;
const wer = (said: string, heard: string) => wordErrorRate(comparable(said), comparable(heard));
const row = (model: string, extra: Partial<Row> = {}): Row => ({
  model,
  label: catalog().entries.find((e) => e.id === model)?.label ?? model,
  device: "cpu",
  jargon: 0.8,
  terms: 5,
  wer: 0.12,
  timing: 0.4,
  speed: 8,
  ...extra,
});
const speech = () => catalog().entries.filter((e) => e.kind === "speech");

beforeEach(() => {
  P = fixtureCopy("video-measure");
  root = mkdtempSync(join(tmpdir(), "testimus-measure-"));
  watched = [];
  stopped = 0;
  denoisedTo = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = mockSpawnClaude;
  pinMachineProfile(mockMachine("cpu-only"));
  setupVideoMock(root);
  measureIo.memory = (model) => {
    watched.push(model);
    return {
      peakMB: () => (model.includes("q5") ? 980 : 1240),
      stop: async () => {
        stopped++;
      },
    };
  };
  measureIo.denoised = async (src, out, to) => {
    denoisedTo.push({ src, to });
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(src, out);
  };
});

afterEach(() => {
  env.spawnClaude = realSpawn;
  Object.assign(videoIo, realIo);
  Object.assign(measureIo, realMeasureIo);
  dropInstall(Q5);
  pinMachineProfile(null);
});

describe("a number reads the same however it was written", () => {
  it("in English: digits and number words, with or without « and », years said in two halves", () => {
    expect(comparable("Two hundred and three")).toEqual(["203"]);
    expect(wer("Open valve 203.", "open valve two hundred and three")).toBe(0);
    expect(comparable("twenty-three")).toEqual(["23"]);
    expect(comparable("twelve hundred")).toEqual(["1200"]);
    expect(comparable("nineteen ninety")).toEqual(["1990"]);
    expect(comparable("two thousand twenty six")).toEqual(["2026"]);
    expect(comparable("one and two")).toEqual(["1", "and", "2"]);
    expect(wer("step 1 / 8", "step one of eight")).toBe(0);
    expect(wer("at 80 %", "at eighty per cent")).toBe(0);
    expect(wer("2.5 bar", "two point five bar")).toBe(0);
    expect(wer("Open valve 203.", "open valve two hundred and four")).toBeCloseTo(1 / 3);
  });

  it("in French: cent, mille, soixante-dix, quatre-vingts, septante and nonante, « et un »", () => {
    expect(comparable("deux cent trois")).toEqual(["203"]);
    expect(comparable("mille neuf cent quatre-vingt-dix-neuf")).toEqual(["1999"]);
    expect(comparable("soixante et onze")).toEqual(["71"]);
    expect(comparable("quatre-vingts")).toEqual(["80"]);
    expect(comparable("nonante-cinq")).toEqual(["95"]);
    expect(comparable("septante et un")).toEqual(["71"]);
    expect(comparable("dix-sept")).toEqual(["17"]);
    expect(wer("Le sectionneur A204 est ouvert.", "le sectionneur A deux cent quatre est ouvert")).toBe(0);
    expect(wer("étape 1 / 8", "étape un sur huit")).toBe(0);
    expect(wer("à 80 %", "à quatre-vingts pour cent")).toBe(0);
    expect(wer("2,5 bars", "deux virgule cinq bars")).toBe(0);
  });

  it("in German: a number written as one word, and the unit said before the tens", () => {
    expect(comparable("zweihundertdrei")).toEqual(["203"]);
    expect(comparable("dreiundzwanzig")).toEqual(["23"]);
    expect(comparable("dreihundertfünfundvierzig")).toEqual(["345"]);
    expect(comparable("neunzehnhundertneunundneunzig")).toEqual(["1999"]);
    expect(comparable("eintausendzweihundert")).toEqual(["1200"]);
    expect(wer("Gleis 12, Weiche 203.", "Gleis zwölf Weiche zweihundertdrei")).toBe(0);
    expect(wer("zu 80 %", "zu achtzig Prozent")).toBe(0);
    expect(comparable("ein und dieselbe Achtung")).toEqual(["1", "und", "dieselbe", "achtung"]);
  });

  it("a code is one form whatever the spacing, and a word that is no number stays a word", () => {
    expect(comparable("S12")).toEqual(["s", "12"]);
    expect(comparable("S 12")).toEqual(["s", "12"]);
    expect(wer("le S12 au PCC", "le S douze au PCC")).toBe(0);
    expect(comparable("1 000 volts")).toEqual(["1000", "volts"]);
    expect(comparable("constructor toString")).toEqual(["constructor", "tostring"]);
    expect(comparable("")).toEqual([]);
  });
});

describe("what the rows say of denoising and of the lighter quantisation", () => {
  it("denoising pays only when it writes more words or more of the project's terms right", () => {
    const worse = verdictsOf([row(Q8), row(Q8, { denoised: true, wer: 0.131 })], speech());
    expect(worse[0]).toMatchObject({ about: "denoising", model: Q8, pays: false });
    expect(worse[0].text).toBe(
      "Denoising does not pay for Whisper large-v3 turbo (8-bit) on this reference — as it is / denoised: words wrong 12 % / 13.1 %, the project's terms right 80 % / 80 %, speed × 8 / × 8, memory not measured / not measured.",
    );
    const better = verdictsOf(
      [row(Q8, { memoryMB: 1240 }), row(Q8, { denoised: true, wer: 0.09, memoryMB: 1250 })],
      speech(),
    );
    expect(better[0].pays).toBe(true);
    expect(better[0].text).toContain("Denoising pays for");
    expect(better[0].text).toContain("memory 1240 MB / 1250 MB");
    expect(verdictsOf([row(Q8), row(Q8, { denoised: true, wer: 0.05, jargon: 0.6 })], speech())[0].pays).toBe(false);
    expect(verdictsOf([row(Q8), row(Q8, { denoised: true, jargon: 1 })], speech())[0].pays).toBe(true);
    const none = verdictsOf([row(Q8)], speech())[0];
    expect(none).toMatchObject({ about: "denoising", pays: null });
    expect(none.text).toContain("not measured");
  });

  it("the 5-bit model pays when it loses neither a term nor a word in a hundred, and is not slower", () => {
    const of = (light: Partial<Row>) =>
      verdictsOf([row(Q8, { memoryMB: 1240 }), row(Q5, { memoryMB: 980, ...light })], speech()).find(
        (v) => v.about === "quantisation",
      );
    const held = of({ wer: 0.125, speed: 9.4 });
    expect(held).toMatchObject({ model: Q5, against: Q8, pays: true });
    expect(held?.text).toBe(
      "Whisper large-v3 turbo (5-bit) pays against Whisper large-v3 turbo (8-bit) on this reference — q8 / q5: words wrong 12 % / 12.5 %, the project's terms right 80 % / 80 %, speed × 8 / × 9.4, memory 1240 MB / 980 MB, download 834 MB / 547 MB.",
    );
    expect(of({ wer: 0.14 })?.pays).toBe(false);
    expect(of({ jargon: 0.6 })?.pays).toBe(false);
    expect(of({ speed: 6 })?.pays).toBe(false);
    const alone = verdictsOf([row(Q8)], speech()).filter((v) => v.about === "quantisation");
    expect(alone).toEqual([
      {
        about: "quantisation",
        model: Q5,
        against: Q8,
        pays: null,
        text: expect.stringContaining("Whisper large-v3 turbo (5-bit) was not heard on it"),
      },
    ]);
    expect(alone[0].text).toContain(`testimus models pull ${Q5}`);
    const small = verdictsOf([row("whisper-small-q5")], speech()).filter((v) => v.about === "quantisation");
    expect(small.map((v) => [v.model, v.against, v.pays])).toEqual([["whisper-small-q5", "whisper-small-q8", null]]);
  });
});

describe("a measure of the models on this PC", () => {
  it("gives the time it took and the peak memory of the engine, and keeps them in the report", async () => {
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const m = await call<Measured>("media.measure", { doc: V }, P);
    expect(m).toMatchObject({ doc: V, video: 1, from: 0, to: 37, words: 30, language: "fr" });
    expect(m.rows).toEqual([
      {
        model: Q8,
        label: "Whisper large-v3 turbo (8-bit)",
        device: "cpu",
        jargon: 1,
        terms: expect.any(Number),
        wer: expect.any(Number),
        timing: 0,
        speed: expect.any(Number),
        seconds: expect.any(Number),
        memoryMB: 1240,
        at: m.at,
      },
    ]);
    expect(watched).toEqual([join(root, "speech", "ggml-large-v3-turbo-q8_0.bin")]);
    expect(stopped).toBe(1);
    expect(m.verdicts.map((v) => [v.about, v.pays])).toEqual([
      ["denoising", null],
      ["quantisation", null],
    ]);
    expect(m.ref).toMatch(/^[0-9a-f]{12}$/);
    expect(report()).toEqual(m);
  });

  it("a number the engine wrote in digits is not a word wrong", async () => {
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const plain = await call<Measured>("media.measure", { doc: V }, P);
    const hear = videoIo.listener;
    videoIo.listener = async (setup, signal) => {
      const l = await hear(setup, signal);
      return {
        ...l,
        hear: async (wav, o, s) => {
          const h = await l.hear(wav, o, s);
          return { ...h, tokens: h.tokens.map((t) => ({ ...t, text: t.text === " deux" ? " 2" : t.text })) };
        },
      };
    };
    const digits = await call<Measured>("media.measure", { doc: V }, P);
    expect(digits.rows[0].wer).toBe(plain.rows[0].wer);
  });

  it("with denoise each model hears the reference twice, and the report says whether it pays", async () => {
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const m = await call<Measured>("media.measure", { doc: V, denoise: true }, P);
    expect(denoisedTo).toEqual([{ src: join(P, "docs", V, "files", "manoeuvre.mp4"), to: 37 }]);
    expect(m.rows.map((r) => [r.model, r.denoised ?? false, r.wer, r.jargon, r.memoryMB])).toEqual([
      [Q8, false, m.rows[0].wer, 1, 1240],
      [Q8, true, m.rows[0].wer, 1, 1240],
    ]);
    expect(watched.length).toBe(2);
    expect(stopped).toBe(2);
    const denoising = m.verdicts.find((v) => v.about === "denoising");
    expect(denoising).toMatchObject({ model: Q8, pays: false });
    expect(denoising?.text).toContain("Denoising does not pay for Whisper large-v3 turbo (8-bit) on this reference");
    expect(denoising?.text).toMatch(/words wrong ([\d.]+ %) \/ \1, the project's terms right 100 % \/ 100 %/);
    expect(denoising?.text).toContain("memory 1240 MB / 1240 MB");
    expect(existsSync(join(P, ".testimus", "measure", `${V}-1-denoised.mka`))).toBe(false);
    expect(existsSync(join(P, ".testimus", "measure", `${V}-1-${Q8}`))).toBe(false);
    expect(report().verdicts).toEqual(m.verdicts);
  });

  it("a model measured later is held against the ones before, until the reference changes", async () => {
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const first = await call<Measured>("media.measure", { doc: V, denoise: true }, P);
    const file = join(root, "speech", "ggml-large-v3-turbo-q5_0.bin");
    writeFileSync(file, "mock\n");
    putInstall({ model: Q5, via: "path", runtime: "whispercpp", path: file, status: "verified" });
    const second = await call<Measured>("media.measure", { doc: V, models: [Q5] }, P);
    expect(second.rows.map((r) => [r.model, r.denoised ?? false, r.memoryMB]).sort()).toEqual([
      [Q5, false, 980],
      [Q8, false, 1240],
      [Q8, true, 1240],
    ]);
    expect(second.rows.find((r) => r.model === Q8)?.at).toBe(first.at);
    const quantisation = second.verdicts.find((v) => v.about === "quantisation");
    expect(quantisation).toMatchObject({ model: Q5, against: Q8 });
    expect(typeof quantisation?.pays).toBe("boolean");
    expect(quantisation?.text).toContain("memory 1240 MB / 980 MB, download 834 MB / 547 MB");
    expect(second.verdicts.find((v) => v.about === "denoising")?.pays).toBe(false);

    await call("media.reference", { doc: V, text: FIRST }, P);
    const stale = await call<Measures>("media.measures", {}, P);
    expect(stale.videos[0]).toMatchObject({ doc: V, stale: true, words: 15 });
    const third = await call<Measured>("media.measure", { doc: V, models: [Q5] }, P);
    expect(third.rows.map((r) => r.model)).toEqual([Q5]);
    expect((await call<Measures>("media.measures", {}, P)).videos[0].stale).toBe(false);
  });

  it("the real denoiser says so when ffmpeg fails, and the real watch gives no figure without an engine", async () => {
    const src = join(P, "docs", V, "files", "manoeuvre.mp4");
    const out = join(root, "out", "denoised.mka");
    await expect(realMeasureIo.denoised(src, out, 10, new AbortController().signal)).rejects.toThrow(UserError);
    await expect(realMeasureIo.denoised(src, out, 10, new AbortController().signal)).rejects.toThrow(
      "ffmpeg could not denoise the sound",
    );
    const watch = realMeasureIo.memory(join(root, "speech", "ggml-large-v3-turbo-q8_0.bin"));
    expect(watch.peakMB()).toBeNull();
    await watch.stop();
  });
});

describe("the reference set of a project", () => {
  it("media.measures lists the videos that have a reference, their language and their saved measures", async () => {
    expect(await call<Measures>("media.measures", {}, P)).toEqual({ videos: [], byLanguage: [], notes: [] });
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const before = await call<Measures>("media.measures", {}, P);
    expect(before.videos).toEqual([
      { doc: V, video: 1, name: "manoeuvre.mp4", language: "fr", words: 30, stale: false, measures: [] },
    ]);
    expect(before.byLanguage).toEqual([]);
    expect(before.notes).toEqual([
      "French: 1 reference video, where 3 to 5 are needed (a few minutes typed by hand in each) before a model is chosen on these figures.",
    ]);
    const m = await call<Measured>("media.measure", { doc: V, denoise: true }, P);
    const after = await call<Measures>("media.measures", {}, P);
    expect(after.videos[0].measures).toEqual([
      {
        model: Q8,
        label: "Whisper large-v3 turbo (8-bit)",
        at: m.at,
        device: "cpu",
        wer: m.rows[0].wer,
        jargon: 1,
        terms: m.rows[0].terms,
        timing: 0,
        speed: m.rows[0].speed,
        seconds: m.rows[0].seconds,
        memoryMB: 1240,
      },
      expect.objectContaining({ model: Q8, denoised: true, wer: m.rows[0].wer }),
    ]);
    expect(after.byLanguage).toEqual([
      {
        language: "fr",
        model: Q8,
        label: "Whisper large-v3 turbo (8-bit)",
        videos: 1,
        references: 1,
        enough: false,
        words: 30,
        wer: m.rows[0].wer,
        jargon: 1,
        terms: m.rows[0].terms,
      },
    ]);
    await call(
      "media.reference",
      { doc: V, text: "[01:32] So, dann bitte den Trennschalter S12 wieder schließen." },
      P,
    );
    expect((await call<Measures>("media.measures", {}, P)).videos[0]).toMatchObject({ language: "de", stale: true });
  });

  it("by language and model, the figures over three videos — each weighs its words; a report of before reads", async () => {
    await call("media.reference", { doc: V, text: [FIRST, SECOND].join("\n") }, P);
    const m = await call<Measured>("media.measure", { doc: V }, P);
    const terms = m.rows[0].terms;
    for (const [id, old] of [
      ["ESSAI_B", { wer: 0.2, jargon: 0.5, terms: 2 }],
      ["ESSAI_C", { wer: 0.4, jargon: null, terms: 0 }],
    ] as const) {
      const file = join(root, `${id}.mp4`);
      writeFileSync(file, JSON.stringify({ duration: 60 }));
      await call("docs.add", { file, id, describeFigures: false, index: false }, P);
      await call("media.reference", { doc: id, text: FIRST }, P);
      mkdirSync(dirname(saved(id)), { recursive: true });
      writeFileSync(
        saved(id),
        JSON.stringify({
          doc: id,
          video: 1,
          at: "2026-11-09T08:00:00.000Z",
          from: 0,
          to: 22,
          words: 15,
          rows: [
            { model: Q8, label: "Whisper large-v3 turbo (8-bit)", device: "gpu", timing: null, speed: 30, ...old },
          ],
        }),
      );
    }
    const all = await call<Measures>("media.measures", {}, P);
    const videos = [...all.videos].sort((a, b) => a.doc.localeCompare(b.doc));
    expect(videos.map((x) => [x.doc, x.language, x.words, x.stale, x.measures.length])).toEqual([
      ["ESSAI_B", "fr", 15, false, 1],
      ["ESSAI_C", "fr", 15, false, 1],
      [V, "fr", 30, false, 1],
    ]);
    expect(videos[0].measures[0]).toEqual({
      model: Q8,
      label: "Whisper large-v3 turbo (8-bit)",
      at: "2026-11-09T08:00:00.000Z",
      device: "gpu",
      wer: 0.2,
      jargon: 0.5,
      terms: 2,
      speed: 30,
    });
    expect(videos[1].measures[0].jargon).toBeUndefined();
    expect(all.byLanguage).toEqual([
      {
        language: "fr",
        model: Q8,
        label: "Whisper large-v3 turbo (8-bit)",
        videos: 3,
        references: 3,
        enough: true,
        words: 60,
        wer: expect.closeTo((0.2 * 15 + 0.4 * 15 + m.rows[0].wer * 30) / 60, 3),
        jargon: Math.round(((terms + 1) / (terms + 2)) * 100) / 100,
        terms: terms + 2,
      },
    ]);
    expect(all.notes).toEqual([]);
  });
});

// ponytail: the one test here that runs the real programs, as video-real.test.ts does and on the same made-up video —
// ffmpeg's denoiser, whisper.cpp and the watch of its memory are only proven by running them. Skipped on a PC that
// has none of them. The reference is what the engine itself heard: the figures say nothing of quality here, only that
// each of them comes out
const SYNTHETIC = resolve(import.meta.dirname, "../../../fixtures/video/synthetic.mp4");
const registryFile = process.env.TESTIMUS_REAL_MODELS ?? join(process.env.APPDATA ?? "", "Testimus", "models.json");

function realRegistry(): ModelsRegistry | null {
  if (!existsSync(registryFile)) return null;
  const r = JSON.parse(readFileSync(registryFile, "utf8")) as ModelsRegistry;
  const here = (p?: string) => !!p && existsSync(p);
  if (!here(r.ffmpeg?.ffmpeg) || !here(r.whisper?.server) || !r.dir) return null;
  return existsSync(join(r.dir, "ggerganov", "whisper.cpp", "ggml-large-v3-turbo-q8_0.bin")) ? r : null;
}

const real = realRegistry();

describe.skipIf(!real)("a measure through the real engine", () => {
  const realHttp = env.http;

  afterEach(() => {
    env.http = realHttp;
    updateRegistry((mine) => {
      delete mine.dir;
      delete mine.runtimesDir;
    });
  });

  it("hears a made-up video as it is and denoised, and reads the engine's peak memory", async () => {
    const r = real as ModelsRegistry;
    Object.assign(videoIo, realIo);
    Object.assign(measureIo, realMeasureIo);
    pinMachineProfile(null);
    dropInstall(Q8);
    env.http = async (req) => {
      if (!req.url.startsWith("http://127.0.0.1:")) throw new Error(`Not this PC: ${req.url}`);
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: (req.bodyBytes as BodyInit | undefined) ?? req.body,
        signal: req.signal,
      });
      return { status: res.status, headers: {}, text: await res.text() };
    };
    updateRegistry((mine) => {
      mine.dir = r.dir;
      mine.runtimesDir = r.runtimesDir;
      mine.ffmpeg = r.ffmpeg;
      mine.whisper = r.whisper;
    });
    await call(
      "docs.add",
      { file: SYNTHETIC, id: "SYNTHETIC", video: { spoken: ["en"] }, describeFigures: false, index: false },
      P,
    );
    const v = JSON.parse(readFileSync(join(P, "docs", "SYNTHETIC", "video", "1.json"), "utf8")) as VideoData;
    expect(v.transcript.length).toBeGreaterThan(0);
    const text = v.transcript.map((l) => `[${clock(l.at)}] ${l.text}`).join("\n");
    await call("media.reference", { doc: "SYNTHETIC", text }, P);
    const m = await call<Measured>("media.measure", { doc: "SYNTHETIC", models: [Q8], denoise: true }, P);
    expect(m.rows.map((x) => [x.model, x.denoised ?? false])).toEqual([
      [Q8, false],
      [Q8, true],
    ]);
    const plain = m.rows[0];
    expect(plain.wer).toBeLessThan(0.2);
    expect(plain.timing).toBeLessThan(1.5);
    expect(plain.seconds).toBeGreaterThan(0);
    for (const x of m.rows) {
      expect(x.memoryMB, `${x.denoised ? "denoised" : "as it is"}: the engine's peak memory`).toBeGreaterThan(200);
      expect(x.memoryMB).toBeLessThan(20_000);
    }
    expect(m.rows[1].wer).toBeLessThan(0.5);
    expect(m.verdicts.find((x) => x.about === "denoising")?.text).toMatch(/Denoising (pays|does not pay) for/);
    expect(existsSync(join(P, ".testimus", "measure", "SYNTHETIC-1-denoised.mka"))).toBe(false);
  }, 300_000);
});
