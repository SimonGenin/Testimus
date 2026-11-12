import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { canonicalSources, loadCorpus, mechanicalFindings, sourceProblem } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { videoIo } from "../../../../src/core/lib/video/io.ts";
import { relocate, resolveTimed, videoText } from "../../../../src/core/lib/video/sources.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { setupVideoMock } from "../../../../src/core/mock/video.ts";
import {
  clock,
  isMediaAnchor,
  momentId,
  momentOf,
  normalizeAnchor,
  parseAnchor,
  secondsOf,
} from "../../../../src/core/rag/anchors.ts";
import type { CheckFile, Source, Test, VideoData } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const V = "Manoeuvre_d_un_sectionneur_au_PCC";
const T = "LFRPS12-1398";
const real = env.spawnClaude;
const realIo = { ...videoIo };
let P = "";

const md = () => readFileSync(join(P, "docs", V, "doc.md"), "utf8");
const video = () => JSON.parse(readFileSync(join(P, "docs", V, "video", "1.json"), "utf8")) as VideoData;
const testMd = () => readFileSync(join(P, "tests", T, "test.md"), "utf8");
const check = () => JSON.parse(readFileSync(join(P, "tests", T, "check.json"), "utf8")) as CheckFile;

function cite(lines: string[]): void {
  const text = testMd();
  const at = text.indexOf("### Sources");
  const end = text.indexOf("\n", text.indexOf("\n- ", at) + 1);
  writeFileSync(join(P, "tests", T, "test.md"), `${text.slice(0, end)}\n${lines.join("\n")}${text.slice(end)}`);
}

beforeEach(() => {
  P = fixtureCopy("video-sources");
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = mockSpawnClaude;
  setupVideoMock(mkdtempSync(join(tmpdir(), "testimus-ffmpeg-")));
});

afterEach(() => {
  env.spawnClaude = real;
  Object.assign(videoIo, realIo);
  resetProbe();
});

describe("anchors of a moment", () => {
  it("write mm:ss, h:mm:ss past an hour, the video's number when it is not file 1, and a range as its two moments", () => {
    expect([clock(0), clock(270.9), clock(3725)]).toEqual(["00:00", "04:30", "1:02:05"]);
    expect([momentId(1, 270), momentId(3, 270), momentId(1, 156, 172), momentId(2, 156, 172)]).toEqual([
      "04:30",
      "3/04:30",
      "02:36..02:52",
      "2/02:36..02:52",
    ]);
    expect(momentId(1, 156, 156.4)).toBe("02:36");
    expect(momentOf("1:02:05")).toEqual({ n: 1, at: 3725 });
    expect(momentOf("02:36..02:52")).toEqual({ n: 1, at: 156, to: 172 });
    expect(momentOf("3/02:36 .. 1:02:52")).toEqual({ n: 3, at: 156, to: 3772 });
    expect(momentOf("02:52..02:36")).toEqual({ n: 1, at: 172 });
    expect(momentOf("§5.6")).toBeNull();
    expect([secondsOf("272.5"), secondsOf("04:32"), secondsOf("soon")]).toEqual([272.5, 272, null]);
  });

  it("a moment is a second of the video, never a line's rank: the -2 a line once carried is read and dropped", () => {
    expect(momentOf("3/04:30-2")).toEqual({ n: 3, at: 270 });
    expect(normalizeAnchor("t:04:30-2")).toBe("t:04:30");
    expect(normalizeAnchor("DOC#t 4:30")).toBe("t:04:30");
    expect(normalizeAnchor("T:02:36..02:52")).toBe("t:02:36..02:52");
    expect(normalizeAnchor("v 02:36..02:52")).toBe("v:02:36..02:52");
    expect(parseAnchor("frame 04:30")).toEqual({ kind: "frame", id: "04:30" });
    expect(parseAnchor("frame:02:36..02:52")).toEqual({ kind: "frame", id: "02:36" });
    expect(parseAnchor("img:3")).toEqual({ kind: "img", id: "3" });
    expect(["t:04:30", "v:00:10..00:20", "frame:00:20", "img:1", "§5", "fig:2"].map(isMediaAnchor)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("what follows t or v and is no moment stays a section's title", () => {
    expect(parseAnchor("t 5")).toEqual({ kind: "§", id: "t 5" });
    expect(parseAnchor("V 2.1 Généralités")).toEqual({ kind: "§", id: "V 2.1 Généralités" });
  });
});

describe("a source in a video is held against time", () => {
  const QUOTE = "on voit que seul Propriétés est proposé";

  it("holds at the second its line starts, a second off, mid-line and a few seconds early — and says its canonical form", () => {
    const vt = videoText(md());
    expect(vt.durations.get(1)).toBe(160);
    expect(vt.lines.length).toBe(11);
    expect(vt.frames.map((f) => f.at)).toEqual([20, 60, 100, 140]);
    for (const a of ["t:00:32", "t:00:33", "t:00:40", "t:00:28"])
      expect(resolveTimed(vt, a, QUOTE), a).toEqual({ ok: true, canonical: "t:00:32", unsure: false });
    expect(resolveTimed(vt, "t:00:32", "")).toEqual({ ok: true, canonical: "t:00:32", unsure: false });
  });

  it("compares the words said, not the punctuation nor the case the model chose", () => {
    const vt = videoText(md());
    const loose = "LÀ ON FAIT CLIC DROIT SUR LE SECTIONNEUR et on voit que seul propriétés est proposé";
    expect(resolveTimed(vt, "t:00:32", loose)).toMatchObject({ ok: true });
    expect(resolveTimed(vt, "t:00:32", "seul Propriété est proposé")).toMatchObject({ ok: false, why: "not-said" });
  });

  it("a quote may run over several lines; a range closes on what it was given, or opens to hold its last line", () => {
    const vt = videoText(md());
    const two = "seul Propriétés est proposé. La fenêtre Propriétés indique un sectionneur";
    expect(resolveTimed(vt, "t:00:32", two)).toMatchObject({ ok: true, canonical: "t:00:32" });
    expect(resolveTimed(vt, "t:00:30..00:55", two)).toEqual({ ok: true, canonical: "t:00:32..00:55", unsure: false });
    expect(resolveTimed(vt, "t:00:32..00:40", two)).toEqual({ ok: true, canonical: "t:00:32..01:02", unsure: false });
  });

  it("says where to listen when the words are not there: elsewhere in the video, or the closest words around", () => {
    const vt = videoText(md());
    expect(resolveTimed(vt, "t:02:00", "on acquitte l'alarme, puis on ferme la fenêtre")).toEqual({
      ok: false,
      why: "not-said",
      elsewhere: "t:01:17",
    });
    const near = resolveTimed(vt, "t:00:32", "on voit que seules les propriétés sont proposées");
    expect(near).toMatchObject({ ok: false, why: "not-said", nearest: { anchor: "t:00:32" } });
    expect(resolveTimed(vt, "t:05:00", QUOTE)).toEqual({ ok: false, why: "no-moment", length: 160 });
    expect(resolveTimed(vt, "t:2/00:10", QUOTE)).toEqual({ ok: false, why: "no-video" });
  });

  it("what is seen is quoted from the description of a key frame of the range", () => {
    const vt = videoText(md());
    const seen = "Le menu contextuel du sectionneur S12 s'ouvre";
    expect(resolveTimed(vt, "v:00:50..01:10", seen)).toEqual({ ok: true, canonical: "v:00:50..01:10", unsure: false });
    expect(resolveTimed(vt, "v:01:10..01:30", seen)).toEqual({ ok: false, why: "no-frame" });
    expect(resolveTimed(vt, "v:01:30..01:50", seen)).toEqual({ ok: false, why: "not-seen", elsewhere: "frame:01:00" });
    expect(resolveTimed(vt, "v:00:50..01:10", "le menu contextuel du sectionneur s12 s'ouvre")).toMatchObject({
      ok: false,
    });
  });

  it("relocate looks for the words within 15 s of where they were", () => {
    const vt = videoText(md());
    expect(relocate(vt, "t:00:20", QUOTE)).toEqual({ anchor: "t:00:32" });
    expect(relocate(vt, "t:01:30", QUOTE)).toEqual({
      nearest: expect.objectContaining({ anchor: expect.any(String) }),
    });
  });
});

describe("the mechanical check of a video source", () => {
  const step = (sources: Source[]) =>
    ({
      summary: "s",
      description: "d",
      steps: [{ fields: { Action: "Clic droit.", "Expected Result": "Seul Propriétés." }, sources, images: [] }],
    }) as unknown as Test;
  const QUOTE = "on voit que seul Propriétés est proposé";
  const kinds = (anchor: string, quote = QUOTE) =>
    mechanicalFindings(step([{ docId: V, anchor, quote }]), loadCorpus(P)).map((f) => f.kind);

  it("accepts a moment, a range and a key frame's description; an expected result on a video alone stays observed-only", () => {
    expect(kinds("t:00:32")).toEqual(["observed-only"]);
    expect(kinds("t:00:35")).toEqual(["observed-only"]);
    expect(kinds("t:00:30..00:50")).toEqual(["observed-only"]);
    expect(kinds("v:00:50..01:10", "Le menu contextuel du sectionneur S12 s'ouvre")).toEqual(["observed-only"]);
    expect(kinds("frame:01:00", "Le menu contextuel du sectionneur S12 s'ouvre")).toEqual(["observed-only"]);
  });

  it("tells a quote said elsewhere, a quote not said (with the closest words), a moment past the end, a range without a key frame", () => {
    const all = (anchor: string, quote = QUOTE) =>
      mechanicalFindings(step([{ docId: V, anchor, quote }]), loadCorpus(P)).filter((f) => f.kind !== "observed-only");
    const elsewhere = all("t:02:00", "on acquitte l'alarme, puis on ferme la fenêtre")[0];
    expect(elsewhere).toMatchObject({ kind: "quote-not-at-anchor", severity: "error" });
    expect(elsewhere.message).toContain("it is at t:01:17");
    expect(elsewhere.sources).toEqual([`${V}#t:02:00`, `${V}#t:01:17`]);
    const lost = all("t:00:32", "on voit que seules les propriétés sont proposées")[0];
    expect(lost).toMatchObject({ kind: "quote-not-found", severity: "error" });
    expect(lost.message).toContain("the closest words there are « Là on fait clic droit");
    expect(lost.message).toContain("at t:00:32 — listen to that moment again");
    expect(all("t:09:00")[0]).toMatchObject({ kind: "source-missing" });
    expect(all("t:09:00")[0].message).toContain("past the end of the video");
    const none = all("v:01:10..01:30", "Le menu contextuel")[0];
    expect(none).toMatchObject({ kind: "source-missing" });
    expect(none.message).toContain("media_keep");
    expect(all("t:00:32", "seul Propriétés")[0]).toMatchObject({ kind: "quote-weak" });
  });

  it("warns when the quote is on a line the engine doubted, until a person confirms it", async () => {
    const unsure = "le message de refus de manœuvre apparaît dans le bandeau d'alarmes";
    expect(kinds("t:01:02", unsure)).toEqual(["quote-uncertain", "observed-only"]);
    const f = mechanicalFindings(step([{ docId: V, anchor: "t:01:02", quote: unsure }]), loadCorpus(P))[0];
    expect(f).toMatchObject({ severity: "warning" });
    expect(f.message).toContain("listen to 01:02");
    await call("media.fix", { doc: V, at: "01:02", index: false }, P);
    expect(kinds("t:01:02", unsure)).toEqual(["observed-only"]);
  });

  it("sourceProblem judges a passage given as proof the same way", () => {
    const corpus = loadCorpus(P);
    expect(sourceProblem(corpus, { docId: V, anchor: "t:00:40", quote: QUOTE })).toBeNull();
    expect(sourceProblem(corpus, { docId: V, anchor: "t:01:05", quote: QUOTE })).toContain("is not at");
    expect(sourceProblem(corpus, { docId: V, anchor: "t:09:00", quote: QUOTE })).toContain("nothing to quote");
  });

  it("writes a source again at the second of the line its quote starts in, and leaves every other line of the test alone", async () => {
    cite([`- ${V}#t:00:40 "${QUOTE}"`, `- ${V}#t:00:30..00:55 "${QUOTE}" @Action "Clic droit"`]);
    const before = testMd();
    const { readTest } = await import("../../../../src/core/lib/store.ts");
    expect(canonicalSources(readTest(P, T).test, loadCorpus(P))).toEqual([
      { step: 1, from: "t:00:40", to: "t:00:32" },
      { step: 1, from: "t:00:30..00:55", to: "t:00:32..00:55" },
    ]);
    await call("check.run", { ids: [T], semantic: false }, P);
    const after = testMd();
    expect(after).toContain(`- ${V}#t:00:32 "${QUOTE}"`);
    expect(after).toContain(`- ${V}#t:00:32..00:55 "${QUOTE}" @Action "Clic droit"`);
    expect(after.split("\n").filter((l, i) => l !== before.split("\n")[i]).length).toBe(2);
    await call("check.run", { ids: [T], semantic: false }, P);
    expect(testMd()).toBe(after);
  });
});

describe("a video heard again", () => {
  const A = "on ouvre le poste de commande et on se connecte";
  const B = "on voit que seul Propriétés est proposé";
  const C = "La fenêtre Propriétés indique un sectionneur sans télécommande";

  // ponytail: the engine of the second hearing cuts otherwise — from 00:30 on every sentence starts 4 s later — and
  // hears one sentence differently
  function hearOtherwise(): void {
    const voices = videoIo.voices;
    videoIo.voices = async (wav, signal) =>
      (await voices(wav, signal)).map((v) => (v.from >= 30 ? { from: v.from + 4, to: v.to + 4 } : v));
    const listener = videoIo.listener;
    videoIo.listener = async (setup, signal) => {
      const l = await listener(setup, signal);
      return {
        ...l,
        hear: async (wav, o, s) => {
          const h = await l.hear(wav, o, s);
          const said = h.tokens.map((t) => t.text).join("");
          if (!said.includes("sans télécommande")) return h;
          return {
            ...h,
            tokens: " La fenêtre des propriétés montre un sectionneur manuel, fermé."
              .split(/(?= )/)
              .map((text, i) => ({ text, from: 0.2 + i, to: 1.2 + i, p: 0.9 })),
          };
        },
      };
    };
  }

  it("keeps the transcript before, and reports each source: holds, moved with its words, or lost", async () => {
    cite([`- ${V}#t:00:02 "${A}"`, `- ${V}#t:00:32 "${B}"`, `- ${V}#t:00:47 "${C}"`]);
    await call(
      "media.fix",
      { doc: V, at: "00:17", text: "Sur le TCO, on repère le sectionneur S12.", index: false },
      P,
    );
    hearOtherwise();
    const r = await call<{ lines: number; report?: { holds: number; moved: number; lost: number } }>(
      "media.retranscribe",
      { doc: V, all: true, index: false },
      P,
    );
    expect(r.report).toMatchObject({ holds: 1, moved: 1, lost: 1 });
    const v = video();
    expect(v.before?.transcript.length).toBe(11);
    expect(v.transcript.map((l) => l.at).slice(0, 4)).toEqual([2, 17, 36, 51]);
    expect(md()).toContain("[00:17] Sur le TCO, on repère le sectionneur S12. <!-- t 00:17 -->");
    const shown = await call<{ videos: { report: boolean; fixed: number }[] }>("media.show", { doc: V }, P);
    expect(shown.videos[0]).toMatchObject({ report: true, fixed: 1 });
    const { report } = await call<{ report: { rows: Record<string, unknown>[] } | null }>(
      "media.report",
      { doc: V },
      P,
    );
    expect(report?.rows).toEqual([
      { test: T, step: 1, from: `${V}#t:00:02`, quote: A, state: "holds" },
      { test: T, step: 1, from: `${V}#t:00:32`, quote: B, state: "moved", to: `${V}#t:00:36` },
      {
        test: T,
        step: 1,
        from: `${V}#t:00:47`,
        quote: C,
        state: "lost",
        nearest: { anchor: "t:00:51", text: "La fenêtre des propriétés montre un sectionneur manuel, fermé." },
      },
    ]);
    expect(testMd()).toContain(`${V}#t:00:32 "${B}"`);
    const applied = await call<{ rewritten: unknown[]; lost: number; undone: boolean }>(
      "media.applyReport",
      { doc: V, index: false },
      P,
    );
    expect(applied).toEqual({
      rewritten: [{ test: T, from: `${V}#t:00:32`, to: `${V}#t:00:36` }],
      lost: 1,
      undone: false,
    });
    expect(testMd()).toContain(`${V}#t:00:36 "${B}"`);
    expect(video().before).toBeUndefined();
    const lost = check().findings.find((f) => f.kind === "source-missing");
    expect(lost?.message).toContain("the closest words there are « La fenêtre des propriétés montre");
    expect(lost?.message).toContain("The video was heard or described again since this source was written.");
    expect((await call<{ report: unknown }>("media.report", { doc: V }, P)).report).toBeNull();
    await expect(call("media.applyReport", { doc: V, index: false }, P)).rejects.toThrow("No new transcription");
  });

  it("can be undone: the transcript before is put back as it was", async () => {
    const was = video().transcript;
    hearOtherwise();
    await call("media.retranscribe", { doc: V, all: true, index: false }, P);
    expect(video().transcript).not.toEqual(was);
    const r = await call<{ undone: boolean }>("media.applyReport", { doc: V, undo: true, index: false }, P);
    expect(r.undone).toBe(true);
    expect(video().transcript).toEqual(was);
    expect(video().before).toBeUndefined();
    expect(md()).toContain("<!-- t 00:32 -->");
  });

  it("hears nothing again when nothing changed: same model, same languages, same glossary", async () => {
    const heard: unknown[] = [];
    const listener = videoIo.listener;
    videoIo.listener = async (setup, signal) => {
      heard.push(setup);
      return listener(setup, signal);
    };
    const was = video();
    const r = await call<{ report?: unknown }>("media.retranscribe", { doc: V, index: false }, P);
    expect(heard).toEqual([]);
    expect(r.report).toBeUndefined();
    expect(video().before).toBeUndefined();
    expect(video().transcript).toEqual(was.transcript);
  });
});
