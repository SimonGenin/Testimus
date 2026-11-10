import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { updateRegistry } from "../../../../src/core/lib/models-registry.ts";
import type { DocJson, ModelsRegistry, VideoData } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

// ponytail: the one test that runs the real programs — ffmpeg, whisper.cpp and a transcription model, as this PC has
// them (its own models.json, or the one TESTIMUS_REAL_MODELS names). On a PC without them it is skipped: every other
// test of the videos runs on the made-up engine. The video is made, not filmed: a still screen, a beep at 2 s (not
// speech), a synthetic voice from 4 s saying a known sentence, a 40 px alarm appearing at 12 s
const SYNTHETIC = resolve(import.meta.dirname, "../../../fixtures/video/synthetic.mp4");
const registryFile = process.env.TESTIMUS_REAL_MODELS ?? join(process.env.APPDATA ?? "", "Testimus", "models.json");

function realRegistry(): ModelsRegistry | null {
  if (!existsSync(registryFile)) return null;
  const r = JSON.parse(readFileSync(registryFile, "utf8")) as ModelsRegistry;
  const here = (p?: string) => !!p && existsSync(p);
  if (!here(r.ffmpeg?.ffmpeg) || !here(r.whisper?.server) || !r.dir) return null;
  const models = join(r.dir, "ggerganov", "whisper.cpp");
  return ["ggml-large-v3-turbo-q8_0.bin", "ggml-small-q8_0.bin"].some((f) => existsSync(join(models, f))) ? r : null;
}

const real = realRegistry();

describe.skipIf(!real)("a synthetic video through the real engine", () => {
  it("is heard on this PC: the sentence comes out, at its place, and the alarm is a key frame", async () => {
    const r = real as ModelsRegistry;
    // ponytail: the unit tests never reach the network; the engine is on this PC — its own address alone is let through
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
    const P = fixtureCopy("video-real");
    const d = await call<DocJson>(
      "docs.add",
      { file: SYNTHETIC, id: "SYNTHETIC", video: { spoken: ["en"] }, describeFigures: false, index: false },
      P,
    );
    expect(d.converted?.warnings).toEqual([]);
    const v = JSON.parse(readFileSync(join(P, "docs", "SYNTHETIC", "video", "1.json"), "utf8")) as VideoData;
    expect(Math.round(v.duration)).toBe(20);
    expect(v.transcribed?.engine).toContain("whisper.cpp");
    const said = v.transcript
      .map((l) => l.text)
      .join(" ")
      .toLowerCase();
    expect(said).toContain("traction overview");
    expect(said).toContain("alarm banner");
    expect(v.transcript[0].at).toBeGreaterThan(3);
    expect(v.transcript[0].at).toBeLessThan(5.5);
    expect(v.transcript.every((l) => l.lang === "en")).toBe(true);
    expect(v.candidates.some((c) => Math.abs(c.at - 12) <= 0.5 && c.box)).toBe(true);
    expect(v.keyFrames.some((k) => Math.abs(k.at - 12) <= 0.5)).toBe(true);
    const md = readFileSync(join(P, "docs", "SYNTHETIC", "doc.md"), "utf8");
    expect(md).toMatch(/\[00:0[345]\] .*<!-- t 00:0[345] -->/);
  }, 300_000);
});
