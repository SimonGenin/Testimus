import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exit, Proc, RunSpec } from "../../../../src/shared/run/process.ts";

const procs = vi.hoisted(() => ({
  run: null as ((spec: RunSpec) => Promise<Exit>) | null,
  start: null as ((spec: RunSpec) => Proc) | null,
}));

vi.mock("../../../../src/shared/run/process.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/shared/run/process.ts")>();
  return {
    ...real,
    run: (spec: RunSpec) => (procs.run ? procs.run(spec) : real.run(spec)),
    start: (spec: RunSpec) => (procs.start ? procs.start(spec) : real.start(spec)),
  };
});

const { resetProbe } = await import("../../../../src/core/claude/status.ts");
const { UserError } = await import("../../../../src/core/command.ts");
const { env } = await import("../../../../src/core/env.ts");
const { pinMachineProfile } = await import("../../../../src/core/lib/machine/profile.ts");
const { catalog } = await import("../../../../src/core/lib/models-catalog.ts");
const { putInstall, readRegistry } = await import("../../../../src/core/lib/models-registry.ts");
const { DEFAULT_SETTINGS, writeSettings } = await import("../../../../src/core/lib/project.ts");
const { speechRoom } = await import("../../../../src/core/lib/video/engine.ts");
const { STALLED, videoIo } = await import("../../../../src/core/lib/video/io.ts");
const { passageLimitMs, startLimitMs, voicesLimitMs } = await import("../../../../src/core/lib/video/passages.ts");
const { paceOf } = await import("../../../../src/core/lib/video/speech.ts");
const { header } = await import("../../../../src/core/lib/video/wav.ts");
const { fetched } = await import("../../../../src/core/lib/whisper.ts");
const { mockSpawnClaude } = await import("../../../../src/core/mock/claude.ts");
await import("../../../../src/core/mock/claude-media.ts");
const { mockMachine } = await import("../../../../src/core/mock/machine.ts");
const { setupVideoMock } = await import("../../../../src/core/mock/video.ts");
const { llamaIo } = await import("../../../../src/core/rag/runtimes/llamacpp.ts");
const { call, FIXTURE, fixtureCopy } = await import("../registry.ts");

import type { HttpReq } from "../../../../src/core/env.ts";
import type { DocJson, MachineProfile, TranscriptMade, VideoData } from "../../../../src/core/types.ts";

const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const VIDEO = join(FIXTURE, "docs", V, "files", "manoeuvre.mp4");
const TURBO = "Whisper large-v3 turbo (8-bit)";
const SMALL = "Whisper small (8-bit)";
const realSpawn = env.spawnClaude;
const realHttp = env.http;
const realIo = { ...videoIo };
const realDownload = llamaIo.download;
let P = "";
let root = "";

const dir = (id: string) => join(P, "docs", id);
const video = (id: string) => JSON.parse(readFileSync(join(dir(id), "video", "1.json"), "utf8")) as VideoData;
const piece = (id: string, k = 1) =>
  JSON.parse(readFileSync(join(dir(id), "video", "1", "transcript", `${k}.json`), "utf8")) as {
    made: TranscriptMade;
    from: number;
    to: number;
  };
const entry = (id: string) => {
  const e = catalog().entries.find((x) => x.id === id);
  if (!e) throw new Error(`No ${id} in the catalog`);
  return e;
};
const stall = () =>
  new UserError("The transcription engine did not answer a passage in 2 min and was ended.", "", STALLED);

// ponytail: every engine a conversion starts is counted, so a test says how many times a video was really heard
function countEngines(hear?: (n: number) => void): { started: number; stopped: number } {
  const seen = { started: 0, stopped: 0 };
  const listener = videoIo.listener;
  videoIo.listener = async (setup, signal) => {
    seen.started++;
    const l = await listener(setup, signal);
    return {
      hear: async (wav, o, s) => {
        hear?.(seen.started);
        return l.hear(wav, o, s);
      },
      stop: async () => {
        seen.stopped++;
        await l.stop();
      },
    };
  };
  return seen;
}

beforeEach(() => {
  P = fixtureCopy("video-hearing");
  root = mkdtempSync(join(tmpdir(), "testimus-hearing-"));
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = (s) => mockSpawnClaude(s);
  setupVideoMock(root);
});

afterEach(() => {
  vi.useRealTimers();
  env.spawnClaude = realSpawn;
  env.http = realHttp;
  Object.assign(videoIo, realIo);
  llamaIo.download = realDownload;
  procs.run = null;
  procs.start = null;
  pinMachineProfile(null);
  resetProbe();
});

describe("a piece carries the sound it came from", () => {
  it("another track, or a range moved without changing its length, redoes the pieces; nothing changed redoes none", async () => {
    const two = join(P, "two-tracks.mp4");
    writeFileSync(two, JSON.stringify({ duration: 120, tracks: 2 }));
    const engines = countEngines();
    const again = () => call("media.retranscribe", { doc: "PART", index: false }, P);
    await call(
      "docs.add",
      {
        file: two,
        id: "PART",
        video: { track: 1, from: "00:30", to: "01:00" },
        describeFigures: false,
        index: false,
      },
      P,
    );
    expect(piece("PART")).toMatchObject({ made: { track: 1, from: 30 }, from: 0, to: 30 });
    expect(video("PART").transcript.map((l) => l.at)).toEqual([32, 47]);
    expect(engines.started).toBe(1);
    await again();
    expect(engines.started).toBe(1);

    await call("media.set", { doc: "PART", track: 0 }, P);
    await again();
    expect(engines.started).toBe(2);
    expect(piece("PART")).toMatchObject({ made: { track: 0, from: 30 }, from: 0, to: 30 });

    await call("media.set", { doc: "PART", from: "00:45", to: "01:15" }, P);
    await again();
    expect(engines.started).toBe(3);
    expect(piece("PART")).toMatchObject({ made: { track: 0, from: 45 }, from: 0, to: 30 });
    expect(video("PART").transcript.map((l) => l.at)).toEqual([47, 62]);

    await call("media.set", { doc: "PART", whole: true, allTracks: true }, P);
    await again();
    expect(engines.started).toBe(4);
    expect(piece("PART").made).not.toHaveProperty("track");
    expect(piece("PART").made).not.toHaveProperty("from");
    expect(engines.stopped).toBe(4);
  });

  it("a piece written before the track and the start were kept is the whole video with all its tracks: it is reused", async () => {
    expect(piece(V).made).toEqual({
      model: "whisper-large-v3-turbo-q8",
      engine: "whisper.cpp mock cpu",
      spoken: [],
      glossary: expect.any(String),
    });
    const engines = countEngines();
    const was = video(V).transcript;
    await call("media.retranscribe", { doc: V, index: false }, P);
    expect(engines.started).toBe(0);
    expect(video(V).transcript).toEqual(was);
  });
});

describe("the memory is looked at before a model is loaded", () => {
  const turbo = () => entry("whisper-large-v3-turbo-q8");
  const small = () => entry("whisper-small-q8");
  const pc = (o: { ramFreeMB: number; cardFreeMB?: number | null }): MachineProfile => {
    const m = mockMachine(o.cardFreeMB === undefined ? "cpu-only" : "gpu16");
    return {
      ...m,
      ramFreeMB: o.ramFreeMB,
      gpus: m.gpus.map((g) => ({
        ...g,
        ...(o.cardFreeMB === null
          ? { vramTotalMB: null, vramUsedMB: null }
          : { vramUsedMB: (g.vramTotalMB ?? 0) - (o.cardFreeMB ?? 0) }),
      })),
    };
  };

  it("decides where a model is heard: the card, the processor, a lighter model, or nowhere", () => {
    const lines: never[] = [];
    expect(speechRoom(turbo(), [small()], pc({ ramFreeMB: 8000, cardFreeMB: 4000 }), { gpu: true, lines })).toEqual({
      entry: turbo(),
      gpu: true,
    });
    expect(speechRoom(turbo(), [small()], pc({ ramFreeMB: 8000 }), { gpu: false, lines })).toEqual({
      entry: turbo(),
      gpu: false,
    });
    expect(speechRoom(turbo(), [small()], pc({ ramFreeMB: 500, cardFreeMB: null }), { gpu: true, lines })).toEqual({
      entry: turbo(),
      gpu: true,
    });

    const onProcessor = speechRoom(turbo(), [small()], pc({ ramFreeMB: 8000, cardFreeMB: 512 }), { gpu: true, lines });
    expect(onProcessor).toMatchObject({ entry: turbo(), gpu: false });
    expect(onProcessor.note).toBe(
      `${TURBO} needs about 0.9 GB on the graphics card (0.5 GB free there): the video is heard on the processor, several times slower. Close what uses the card to hear the next one faster.`,
    );

    const lighter = speechRoom(turbo(), [small()], pc({ ramFreeMB: 1024 }), { gpu: false, lines });
    expect(lighter).toMatchObject({ entry: small(), gpu: false });
    expect(lighter.note).toBe(
      `${TURBO} needs about 1.3 GB of memory, and this PC has 1.0 GB free: the video is heard with ${SMALL}, the lighter model. Close other programs and hear it again (testimus media retranscribe) for the better one.`,
    );
    expect(
      speechRoom(turbo(), [small()], pc({ ramFreeMB: 1024, cardFreeMB: 700 }), { gpu: true, lines }),
    ).toMatchObject({ entry: small(), gpu: true });

    const nowhere = speechRoom(turbo(), [], pc({ ramFreeMB: 1024 }), { gpu: false, lines });
    expect(nowhere.entry).toBeNull();
    expect(nowhere.note).toBe(
      `${TURBO} needs about 1.3 GB of memory, and this PC has 1.0 GB free, so the video has no transcript. Close other programs, or install a lighter model in Settings › Models › Transcription, then convert the document again.`,
    );
    expect(speechRoom(turbo(), [small()], pc({ ramFreeMB: 512 }), { gpu: false, lines }).entry).toBeNull();
  });

  it("a PC short of memory hears with the lighter model installed and says so; with none, no transcript and no crash", async () => {
    pinMachineProfile({ ...mockMachine("cpu-only"), ramFreeMB: 1024 });
    const engines = countEngines();
    const none = await call<DocJson>("docs.add", { file: VIDEO, id: "SHORT", describeFigures: false, index: false }, P);
    expect(none.converted?.warnings).toEqual([
      expect.stringContaining(`manoeuvre.mp4: ${TURBO} needs about 1.3 GB of memory, and this PC has 1.0 GB free, so`),
    ]);
    expect(video("SHORT").transcript).toEqual([]);
    expect(video("SHORT").transcribed).toBeUndefined();
    expect(video("SHORT").keyFrames.length).toBeGreaterThan(0);
    expect(engines.started).toBe(0);

    const model = join(root, "speech", "ggml-small-q8_0.bin");
    writeFileSync(model, "mock\n");
    putInstall({ model: "whisper-small-q8", via: "path", runtime: "whispercpp", path: model, status: "verified" });
    const asked: string[] = [];
    const listener = videoIo.listener;
    videoIo.listener = async (setup, signal) => {
      asked.push(setup.model);
      return listener(setup, signal);
    };
    const light = await call<DocJson>("docs.convert", { id: "SHORT", describeFigures: false, index: false }, P);
    expect(light.converted?.warnings).toEqual([
      expect.stringContaining(`the video is heard with ${SMALL}, the lighter model`),
    ]);
    expect(asked).toEqual([model]);
    expect(video("SHORT").transcribed).toMatchObject({ model: "whisper-small-q8", with: SMALL });
    expect(video("SHORT").transcript.length).toBe(11);
    expect(piece("SHORT").made.model).toBe("whisper-small-q8");
  });

  it("a transcript the better model made is not replaced by a lighter model's when memory is short", async () => {
    const model = join(root, "speech", "ggml-small-q8_0.bin");
    writeFileSync(model, "mock\n");
    putInstall({ model: "whisper-small-q8", via: "path", runtime: "whispercpp", path: model, status: "verified" });
    pinMachineProfile({ ...mockMachine("cpu-only"), ramFreeMB: 1024 });
    const engines = countEngines();
    const was = video(V).transcript;
    const r = await call<{ warnings: string[] }>("media.retranscribe", { doc: V, all: true, index: false }, P);
    expect(r.warnings).toEqual([expect.stringContaining("was not heard again and keeps its transcript")]);
    expect(engines.started).toBe(0);
    expect(video(V).transcript).toEqual(was);
    expect(video(V).transcribed?.model).toBe("whisper-large-v3-turbo-q8");
  });
});

describe("the time limits of a hearing", () => {
  it("follow the length given and this PC's speed, never under two minutes", () => {
    expect([voicesLimitMs(0), voicesLimitMs(90), voicesLimitMs(600), voicesLimitMs(690)]).toEqual([
      120_000, 120_000, 600_000, 690_000,
    ]);
    expect(passageLimitMs(10, 30)).toBe(120_000);
    expect(passageLimitMs(10, 4)).toBe(120_000);
    expect(passageLimitMs(3, 1.5)).toBe(200_000);
    expect(passageLimitMs(28, 1.5)).toBe(200_000);
    expect(passageLimitMs(28, 0.5)).toBe(600_000);
    expect(passageLimitMs(28, 0)).toBe(6_000_000);
    expect([startLimitMs(0), startLimitMs(252), startLimitMs(834), startLimitMs(3000)]).toEqual([
      120_000, 120_000, 208_500, 750_000,
    ]);
  });

  it("the time left starts from the speed this PC measured and moves to the run's own; with no journal, the run's own after 3 s", () => {
    expect(paceOf(null, 0, 0)).toBeNull();
    expect(paceOf(null, 30, 2000)).toBeNull();
    expect(paceOf(null, 40, 10_000)).toBe(4);
    expect(paceOf(20, 0, 0)).toBe(20);
    expect(paceOf(20, 30, 2000)).toBe(20);
    expect(paceOf(20, 60, 15_000)).toBe(16);
    expect(paceOf(20, 120, 30_000)).toBe(12);
    expect(paceOf(20, 240, 60_000)).toBe(4);
    expect(paceOf(20, 2400, 600_000)).toBe(4);
  });
});

describe("the engine's programs", () => {
  const sound = (seconds: number) => {
    const data = Buffer.alloc(Math.round(seconds * 32_000));
    return Buffer.concat([header(16_000, data.length), data]);
  };
  const exit = (o: Partial<Exit> = {}): Exit => ({
    code: 0,
    stdout: "",
    stderr: "",
    cancelled: false,
    timedOut: false,
    ...o,
  });
  const model = () => join(root, "speech", "ggml-large-v3-turbo-q8_0.bin");
  const answer = {
    detected_language: "english",
    detected_language_probability: 0.97,
    language_probabilities: { en: 0.97 },
    segments: [{ words: [{ word: " Alarm", start: 0.2, end: 0.6, probability: 0.9 }] }],
  };
  // ponytail: a made-up whisper-server — its process never ends by itself, its page answers at once, a passage is
  // answered by `infer` (or never, until its request is cancelled)
  function server(infer?: (req: HttpReq) => Promise<string>) {
    const seen = { specs: [] as RunSpec[], killed: 0, posts: [] as HttpReq[] };
    procs.start = (spec) => {
      seen.specs.push(spec);
      return {
        pid: 4242,
        exited: new Promise<Exit>(() => {}),
        write() {},
        end() {},
        kill: async () => {
          seen.killed++;
        },
      };
    };
    env.http = async (req) => {
      if (req.method === "GET") return { status: 200, headers: {}, text: "" };
      seen.posts.push(req);
      if (infer) return { status: 200, headers: {}, text: await infer(req) };
      return new Promise((_, reject) =>
        req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true }),
      );
    };
    return seen;
  }

  it("the voice detector and the engine are started with a low priority, the detector's lines are read", async () => {
    const specs: RunSpec[] = [];
    procs.run = async (spec) => {
      specs.push(spec);
      return exit({
        stdout: "Speech segment 0: start = 40.00, end = 310.00\nSpeech segment 1: start = 402, end = 655\n",
      });
    };
    const w = readRegistry().whisper;
    const voices = await realIo.voices(join(P, "piece.wav"), new AbortController().signal, 12);
    expect(voices).toEqual([
      { from: 0.4, to: 3.1 },
      { from: 4.02, to: 6.55 },
    ]);
    expect(specs.length).toBe(1);
    expect(specs[0]).toMatchObject({ exe: w?.vad, priority: "low" });
    expect(specs[0].timeoutMs).toBeUndefined();
    expect(specs[0].args).toEqual(expect.arrayContaining(["-f", join(P, "piece.wav"), "-vm", w?.vadModel]));

    const seen = server(async () => JSON.stringify(answer));
    const l = await realIo.listener({ model: model(), gpu: false, threads: 3, speed: 4 }, new AbortController().signal);
    expect(seen.specs.length).toBe(1);
    expect(seen.specs[0]).toMatchObject({ exe: w?.server, cwd: w?.dir, priority: "low" });
    expect(seen.specs[0].args).toEqual(
      expect.arrayContaining(["-m", model(), "--host", "127.0.0.1", "-t", "3", "-ng"]),
    );
    const heard = await l.hear(sound(4), { language: "en" }, new AbortController().signal);
    expect(heard.tokens).toEqual([{ text: " Alarm", from: 0.2, to: 0.6, p: 0.9 }]);
    expect(seen.posts[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/inference$/);
    await l.stop();
    expect(seen.killed).toBe(1);
  });

  it("a detector that failed says why; one that did not finish in its time is ended and told apart", async () => {
    procs.run = async () => exit({ code: 3, stderr: "error: failed to load the VAD model\n" });
    await expect(realIo.voices(join(P, "piece.wav"), new AbortController().signal, 12)).rejects.toThrow(
      "The voice detector failed: error: failed to load the VAD model",
    );
    vi.useFakeTimers();
    procs.run = (spec) =>
      new Promise((res) => spec.signal?.addEventListener("abort", () => res(exit({ code: 124, timedOut: true }))));
    const stuck = realIo.voices(join(P, "piece.wav"), new AbortController().signal, 600);
    const failed = expect(stuck).rejects.toMatchObject({
      code: STALLED,
      message: "The voice detector did not finish in 10 min and was ended.",
    });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await vi.advanceTimersByTimeAsync(70_000);
    await failed;
  });

  it("a passage has the time its length and this PC's speed give it; a PC that slept starts the wait over", async () => {
    const seen = server();
    const l = await realIo.listener(
      { model: model(), gpu: false, threads: 3, speed: 0.5 },
      new AbortController().signal,
    );
    vi.useFakeTimers();
    let state = "waiting";
    let said = "";
    void l.hear(sound(28), {}, new AbortController().signal).catch((e) => {
      state = (e as { code?: string }).code ?? "failed";
      said = (e as Error).message;
    });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(state).toBe("waiting");
    vi.setSystemTime(Date.now() + 8 * 3_600_000);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(70_000);
    expect(state).toBe(STALLED);
    expect(said).toBe("The transcription engine did not answer a passage in 10 min and was ended.");
    expect(seen.posts.length).toBe(1);
    expect(seen.posts[0].signal?.aborted).toBe(true);

    const caller = new AbortController();
    const cancelled = expect(l.hear(sound(28), {}, caller.signal)).rejects.toThrow("Cancelled.");
    caller.abort();
    await cancelled;
  });

  it("an engine that does not get ready in the time its model's size gives it is ended", async () => {
    const seen = server();
    env.http = async () => {
      throw new Error("ECONNREFUSED");
    };
    vi.useFakeTimers();
    const starting = realIo.listener({ model: model(), gpu: true, threads: 3 }, new AbortController().signal);
    const failed = expect(starting).rejects.toMatchObject({
      code: STALLED,
      message: "The transcription engine did not get ready in 2 min and was ended.",
    });
    await vi.advanceTimersByTimeAsync(130_000);
    await failed;
    expect(seen.specs[0].args).not.toContain("-ng");
    expect(seen.killed).toBe(1);
  });
});

describe("a piece that ran into a time limit", () => {
  it("is tried once more with an engine started anew, and nothing is said when that one hears it", async () => {
    let stalled = 0;
    const engines = countEngines((n) => {
      if (n === 1) {
        stalled++;
        throw stall();
      }
    });
    const d = await call<DocJson>("docs.add", { file: VIDEO, id: "ONCE", describeFigures: false, index: false }, P);
    expect(d.converted?.warnings).toEqual([]);
    expect(stalled).toBe(1);
    expect(engines).toEqual({ started: 2, stopped: 2 });
    expect(video("ONCE").transcript.length).toBe(11);
  });

  it("twice is a warning: the pieces heard before it are kept and the next conversion goes on from there", async () => {
    const long = join(P, "long.mp4");
    writeFileSync(long, JSON.stringify({ duration: 1500 }));
    let piece2 = false;
    const voices = videoIo.voices;
    let pieces = 0;
    videoIo.voices = async (wav, signal, seconds) => {
      pieces++;
      piece2 = pieces >= 2;
      return voices(wav, signal, seconds);
    };
    const engines = countEngines(() => {
      if (piece2) throw stall();
    });
    const d = await call<DocJson>("docs.add", { file: long, id: "TWICE", describeFigures: false, index: false }, P);
    expect(d.converted?.warnings).toEqual([
      "long.mp4: The transcription engine did not answer a passage in 2 min and was ended.",
    ]);
    expect(pieces).toBe(3);
    expect(engines).toEqual({ started: 2, stopped: 2 });
    expect(existsSync(join(dir("TWICE"), "video", "1", "transcript", "1.json"))).toBe(true);
    expect(existsSync(join(dir("TWICE"), "video", "1", "transcript", "2.json"))).toBe(false);
    expect(video("TWICE").transcribed?.pieces).toEqual({ done: 1, total: 3 });

    Object.assign(videoIo, realIo);
    setupVideoMock(root);
    const again = countEngines();
    const whole = await call<DocJson>("docs.convert", { id: "TWICE", describeFigures: false, index: false }, P);
    expect(whole.converted?.warnings).toEqual([]);
    expect(again.started).toBe(1);
    expect(video("TWICE").transcribed?.pieces).toBeUndefined();
    expect(video("TWICE").transcript.length).toBe(100);
  });
});

describe("a copy of the engine on the team's channel", () => {
  const bytes = Buffer.from("the pinned build of the engine");
  const want = {
    name: "whisper-bin-x64.zip",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
  const none = new AbortController().signal;

  function channel(content: Buffer | null): string {
    const folder = mkdtempSync(join(tmpdir(), "testimus-channel-"));
    if (content) {
      mkdirSync(join(folder, "runtimes"), { recursive: true });
      writeFileSync(join(folder, "runtimes", want.name), content);
    }
    writeSettings({ ...DEFAULT_SETTINGS, updates: { from: folder } });
    return folder;
  }

  function network(): { asked: string[] } {
    const seen = { asked: [] as string[] };
    llamaIo.download = async (url, file, onBytes) => {
      seen.asked.push(url);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      onBytes(bytes.length, bytes.length);
    };
    return seen;
  }

  it("is taken before the network when it is the pinned file", async () => {
    channel(bytes);
    const net = network();
    const out = join(root, "dl", want.name);
    mkdirSync(dirname(out), { recursive: true });
    const progress: number[] = [];
    await fetched("https://github.invalid/whisper-bin-x64.zip", out, want, (l) => progress.push(l), none);
    expect(readFileSync(out)).toEqual(bytes);
    expect(net.asked).toEqual([]);
    expect(progress.at(-1)).toBe(bytes.length);
    expect(existsSync(`${out}.part`)).toBe(false);
  });

  it("a channel without it, with another file under its name, or no channel at all leaves it to the network — same SHA-256 either way", async () => {
    const net = network();
    const out = (n: number) => {
      const f = join(root, `dl-${n}`, want.name);
      mkdirSync(dirname(f), { recursive: true });
      return f;
    };
    channel(null);
    await fetched("https://github.invalid/a", out(1), want, () => {}, none);
    channel(Buffer.from("another file, of another length"));
    await fetched("https://github.invalid/b", out(2), want, () => {}, none);
    channel(Buffer.from(bytes.toString().replace("pinned", "forged")));
    await fetched("https://github.invalid/c", out(3), want, () => {}, none);
    writeSettings({ ...DEFAULT_SETTINGS });
    await fetched("https://github.invalid/d", out(4), want, () => {}, none);
    expect(net.asked).toEqual([
      "https://github.invalid/a",
      "https://github.invalid/b",
      "https://github.invalid/c",
      "https://github.invalid/d",
    ]);
    for (const n of [1, 2, 3, 4]) expect(readFileSync(out(n))).toEqual(bytes);

    channel(null);
    llamaIo.download = async (_url, file) => writeFileSync(file, "what a proxy made of it");
    await expect(fetched("https://github.invalid/e", out(5), want, () => {}, none)).rejects.toThrow(
      "does not match its pinned SHA-256",
    );
    expect(existsSync(out(5))).toBe(false);
  });
});
