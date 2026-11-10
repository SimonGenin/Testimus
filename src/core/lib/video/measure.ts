import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { killChildrenOnExit, liveChildren, run, start } from "../../../shared/run/process.ts";
import type { Ctx } from "../../command.ts";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { momentOf } from "../../rag/anchors.ts";
import type { CatalogEntry, MediaFile, SpokenLine, VideoData } from "../../types.ts";
import { writeAtomic } from "../atomic.ts";
import { docDir, listDocs } from "../docs.ts";
import { ffmpegOrFail } from "../ffmpeg.ts";
import { machineProfile } from "../machine/profile.ts";
import { filesOf, isMediaDoc } from "../media.ts";
import { readVideo } from "../media-md.ts";
import { readJson, readProject, writeJson } from "../project.ts";
import { installedWhisper } from "../whisper.ts";
import { speechModels, speechSetup } from "./engine.ts";
import { speechGlossary } from "./glossary.ts";
import { cancelled } from "./io.ts";
import { spoken } from "./lines.ts";
import { comparable } from "./numbers.ts";
import { spokenName } from "./passages.ts";
import { transcribe } from "./speech.ts";

export type Measure = {
  model: string;
  label: string;
  device: "gpu" | "cpu";
  denoised?: boolean;
  jargon: number | null;
  terms: number;
  wer: number;
  timing: number | null;
  speed: number;
  seconds?: number;
  memoryMB?: number;
  at?: string;
};
export type Verdict = {
  about: "denoising" | "quantisation";
  model?: string;
  against?: string;
  pays: boolean | null;
  text: string;
};
// ponytail: eval/speech/<doc>-<n>.json — derived, written here alone: what each model made of the video's reference.
// `ref` is the reference the rows were measured against (a row is kept from one measure to the next while it is the
// same), `verdicts` what the rows say of denoising and of the lighter quantisation. A report written before
// 2026-11-10 has neither, nor a row's seconds, memory and date: every one of them is optional
export type MeasureReport = {
  doc: string;
  video: number;
  at: string;
  from: number;
  to: number;
  words: number;
  language?: string;
  ref?: string;
  rows: Measure[];
  verdicts?: Verdict[];
};

export const REFERENCE_FLOOR = 3;
const HELD = 0.01;
const DENOISE = "afftdn";
const WATCH_EVERY_MS = 1000;
const KB = 1024;

export const referenceFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.reference.txt`);

const reportFile = (project: string, docId: string, n: number) => join(project, "eval", "speech", `${docId}-${n}.json`);

export const readMeasures = (project: string, docId: string, n: number): MeasureReport | null =>
  readJson<MeasureReport | null>(reportFile(project, docId, n), null);

// ponytail: the reference is what a person heard, typed by hand — a line a sentence, each starting with its moment
// ([02:36] …), over a few minutes of the video; it is state, like a correction
export function readReference(project: string, docId: string, n: number): { at: number; text: string }[] {
  const file = referenceFile(project, docId, n);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((l) => {
      const m = /^\s*\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s+(.+)$/.exec(l);
      const at = m ? momentOf(m[1])?.at : undefined;
      return m && at !== undefined ? [{ at, text: m[2].trim() }] : [];
    })
    .sort((a, b) => a.at - b.at);
}

export function writeReference(project: string, docId: string, n: number, text: string): number {
  const file = referenceFile(project, docId, n);
  if (!text.trim()) {
    rmSync(file, { force: true });
    return 0;
  }
  writeAtomic(file, `${text.replace(/\r\n/g, "\n").trim()}\n`);
  return readReference(project, docId, n).length;
}

const refOf = (reference: { at: number; text: string }[]) =>
  createHash("sha256").update(JSON.stringify(reference)).digest("hex").slice(0, 12);

// ponytail: the word error rate — the fewest words to replace, drop or add to turn what the engine wrote into what
// was said, over the words said; both sides without case nor punctuation and with their numbers in one form
// (numbers.ts comparable)
export function wordErrorRate(reference: string[], heard: string[]): number {
  if (!reference.length) return heard.length ? 1 : 0;
  let prev = Array.from({ length: heard.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i++) {
    const row = [i];
    for (let j = 1; j <= heard.length; j++)
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (reference[i - 1] === heard[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[heard.length] / reference.length;
}

// ponytail: of the glossary's terms really said (they are in the reference), how many the engine wrote right — where
// a mistake costs: a step quotes the name of an equipment
export function jargonRecall(terms: string[], reference: string, heard: string): { said: number; right: number } {
  const ref = ` ${spoken(reference)} `;
  const got = ` ${spoken(heard)} `;
  const said = terms.map((t) => spoken(t)).filter((t) => t && ref.includes(` ${t} `));
  return { said: said.length, right: said.filter((t) => got.includes(` ${t} `)).length };
}

// ponytail: how far a line's anchor is from where the sentence starts — for each sentence of the reference, the line
// heard that shares most of its words (half at least); the median of the gaps is the promise « to the second »
export function timingError(reference: { at: number; text: string }[], heard: SpokenLine[]): number | null {
  const gaps: number[] = [];
  for (const r of reference) {
    const words = new Set(spoken(r.text).split(" ").filter(Boolean));
    if (words.size < 3) continue;
    let best: SpokenLine | null = null;
    let score = 0;
    for (const h of heard.filter((x) => Math.abs(x.at - r.at) <= 20)) {
      const s =
        spoken(h.text)
          .split(" ")
          .filter((w) => words.has(w)).length / words.size;
      if (s > score) {
        score = s;
        best = h;
      }
    }
    if (best && score >= 0.5) gaps.push(Math.abs(best.at - r.at));
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor((gaps.length - 1) / 2)] * 10) / 10;
}

const WATCH = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "while (Get-Process -Id $env:TESTIMUS_WATCH_PARENT) {",
  '  Get-CimInstance Win32_Process -Filter "Name = \'$env:TESTIMUS_WATCH_EXE\'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:TESTIMUS_WATCH_MODEL) } | ForEach-Object { [Console]::Out.WriteLine("$($_.ProcessId) $($_.PeakWorkingSetSize)") }',
  `  Start-Sleep -Milliseconds ${WATCH_EVERY_MS}`,
  "}",
].join("\n");

export type MemoryWatch = { peakMB(): number | null; stop(): Promise<void> };

// ponytail: a seam env does not have — what a measure asks of the machine beside the transcription itself; the tests
// answer both
export const measureIo = {
  // ponytail: the engine is a process of its own, started and killed inside the transcription: its peak cannot be
  // read once it is gone, and Node says nothing of a child's memory. Windows keeps each process's peak working set,
  // so one small PowerShell asks for it every second while the model is heard — of the engine's processes started by
  // this very process since the watch began, on this model's file — and the last answer before the engine goes is
  // the peak, a second or two short at most. It ends with this process, whatever ends it. No figure elsewhere than on
  // Windows (the engine has no other build), and it is the processor's memory: what a card holds is not in it
  memory(model: string): MemoryWatch {
    const server = installedWhisper()?.server;
    if (process.platform !== "win32" || !server) return { peakMB: () => null, stop: async () => {} };
    killChildrenOnExit();
    const before = new Set(liveChildren());
    let kb = 0;
    const proc = start({
      exe: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WATCH, "utf16le").toString("base64")],
      env: {
        ...process.env,
        TESTIMUS_WATCH_PARENT: String(process.pid),
        TESTIMUS_WATCH_EXE: basename(server),
        TESTIMUS_WATCH_MODEL: basename(model),
      },
      onLine: (line, stream) => {
        const m = stream === "stdout" ? /^(\d+) (\d+)$/.exec(line.trim()) : null;
        if (m && !before.has(Number(m[1])) && liveChildren().includes(Number(m[1]))) kb = Math.max(kb, Number(m[2]));
      },
    });
    return { peakMB: () => (kb ? Math.round(kb / KB) : null), stop: () => proc.kill() };
  },

  // ponytail: the sound through ffmpeg's FFT denoiser (afftdn, as it comes), in a copy the engine then hears like the
  // video itself: every track kept at its place on the video's clock, from the start to the end of the part measured,
  // so the same range is drawn from it and the lines keep their moments. The filter lives here and not where a
  // conversion draws its sound: nothing but a measure denoises, until a measure says it pays
  async denoised(src: string, out: string, to: number, signal: AbortSignal): Promise<void> {
    mkdirSync(dirname(out), { recursive: true });
    const r = await run({
      exe: ffmpegOrFail().ffmpeg,
      args: [
        "-hide_banner",
        "-nostats",
        "-y",
        "-to",
        String(to),
        "-i",
        src,
        "-vn",
        "-map",
        "0:a",
        "-af",
        `aresample=async=1:first_pts=0,${DENOISE}`,
        "-c:a",
        "flac",
        out,
      ],
      signal,
      timeoutMs: 30 * 60_000,
      priority: "low",
    });
    if (signal.aborted) throw cancelled();
    if (r.code !== 0)
      throw new UserError(
        `ffmpeg could not denoise the sound: ${(r.stderr.trim().split("\n").at(-1) ?? r.error ?? "").slice(0, 300)}`,
        "Measure without denoising (leave --denoise out).",
      );
  },
};

const percent = (x: number) => `${Math.round(x * 1000) / 10} %`;
const jargonOf = (r: Measure) => (r.jargon === null ? "none said" : percent(r.jargon));
const memoryOf = (r: Measure) => (r.memoryMB === undefined ? "not measured" : `${r.memoryMB} MB`);
const sideBySide = (a: Measure, b: Measure) =>
  `words wrong ${percent(a.wer)} / ${percent(b.wer)}, the project's terms right ${jargonOf(a)} / ${jargonOf(b)}, speed × ${a.speed} / × ${b.speed}, memory ${memoryOf(a)} / ${memoryOf(b)}`;
const jargonHeld = (a: Measure, b: Measure) => (b.jargon ?? 0) >= (a.jargon ?? 0);

// ponytail: what the rows say of the two things a measure is there to settle, a plain sentence each with the figures
// side by side. Denoising costs a pass of ffmpeg and takes from the voice as well as from the noise: it pays only
// when it writes the project's terms no worse and gets a word in a hundred more right (or more of the terms). A
// lighter quantisation is a smaller file: it pays when it loses neither a term nor more than a word in a hundred, and
// is not slower by more than a tenth. What was not heard both ways is said to be not measured, never guessed
export function verdictsOf(rows: Measure[], entries: CatalogEntry[]): Verdict[] {
  const plain = new Map(rows.filter((r) => !r.denoised).map((r) => [r.model, r]));
  const out: Verdict[] = [];
  for (const d of rows.filter((r) => r.denoised)) {
    const a = plain.get(d.model);
    if (!a) continue;
    const pays = jargonHeld(a, d) && (d.wer <= a.wer - HELD || (d.jargon ?? 0) > (a.jargon ?? 0));
    out.push({
      about: "denoising",
      model: d.model,
      pays,
      text: `Denoising ${pays ? "pays" : "does not pay"} for ${a.label} on this reference — as it is / denoised: ${sideBySide(a, d)}.`,
    });
  }
  if (!out.length)
    out.push({
      about: "denoising",
      pays: null,
      text: "Whether denoising pays is not measured on this reference: measure with denoise, and each model hears it once as it is and once denoised.",
    });
  const stem = (id: string) => id.replace(/-q\d+$/, "");
  for (const heavy of entries) {
    for (const light of entries.filter(
      (e) => e.id !== heavy.id && stem(e.id) === stem(heavy.id) && e.size.downloadMB < heavy.size.downloadMB,
    )) {
      const a = plain.get(heavy.id);
      const b = plain.get(light.id);
      if (!a && !b) continue;
      const names = { about: "quantisation" as const, model: light.id, against: heavy.id };
      if (!a || !b) {
        const missing = a ? light : heavy;
        out.push({
          ...names,
          pays: null,
          text: `Whether ${light.label} pays against ${heavy.label} is not measured on this reference: ${missing.label} was not heard on it (install it — testimus models pull ${missing.id} — and measure again).`,
        });
        continue;
      }
      const pays = jargonHeld(a, b) && b.wer <= a.wer + HELD && b.speed >= a.speed * 0.9;
      out.push({
        ...names,
        pays,
        text: `${light.label} ${pays ? "pays" : "does not pay"} against ${heavy.label} on this reference — ${heavy.quantization} / ${light.quantization}: ${sideBySide(a, b)}, download ${heavy.size.downloadMB} MB / ${light.size.downloadMB} MB.`,
      });
    }
  }
  return out;
}

// ponytail: the language a reference is in — the one most heard in the part of the video it covers, else the one the
// video is said to be in when there is only one
function languageOf(project: string, f: MediaFile, v: VideoData | null, from: number, to: number): string | undefined {
  const heard = new Map<string, number>();
  for (const l of v?.transcript ?? [])
    if (l.lang && l.at >= from && l.at <= to) heard.set(l.lang, (heard.get(l.lang) ?? 0) + Math.max(1, l.end - l.at));
  const most = [...heard.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const asked = f.spoken ?? readProject(project).video?.spoken ?? [];
  return most ?? (asked.length === 1 ? asked[0].toLowerCase() : undefined);
}

const spanOf = (reference: { at: number }[], duration: number) => {
  const from = Math.max(0, reference[0].at - 2);
  return { from, to: Math.min(duration, (reference.at(-1)?.at ?? from) + 20) };
};

const best = (a: Measure, b: Measure) =>
  (b.jargon ?? 0) - (a.jargon ?? 0) || a.wer - b.wer || Number(!!a.denoised) - Number(!!b.denoised);

// ponytail: the models on this PC, each heard on the part of the video a person transcribed by hand, and held
// against it — the glossary's terms written right first (what a test quotes), then the word error rate, how far the
// anchors are, how fast it went and the memory the engine took. With denoise each is heard twice, as it is and
// through the denoiser. The default is chosen on these figures, not on public benchmarks. Nothing of the document is
// touched: each model works in a folder of its own, removed after. A model not heard this time keeps the row of its
// last measure while the reference is the same, so a model installed later is held against the ones before
export async function measureSpeech(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  o: { models?: string[]; denoise?: boolean } = {},
): Promise<MeasureReport> {
  const reference = readReference(project, docId, f.n);
  const v = readVideo(project, docId, f.n);
  if (!reference.length || !v)
    throw new UserError(
      `${f.name} has no reference transcript.`,
      "Type a few minutes of what is said, a sentence a line, each starting with its moment ([02:36] …), in Documents › Video › Reference (or: testimus media reference <doc> --text …).",
    );
  const { from, to } = spanOf(reference, v.duration);
  const glossary = speechGlossary(project);
  const said = reference.map((r) => r.text).join(" ");
  const words = comparable(said);
  const machine = await machineProfile().catch(() => null);
  const here = speechModels().filter((m) => m.path && (!o.models?.length || o.models.includes(m.entry.id)));
  if (!here.length)
    throw new UserError("No transcription model is on this PC.", "Install one in Settings › Models › Transcription.");
  const at = env.now().toISOString();
  const work = join(project, ".testimus", "measure");
  const src = join(docDir(project, docId), f.file);
  const clean = join(work, `${docId}-${f.n}-denoised.mka`);
  const rows: Measure[] = [];
  try {
    if (o.denoise) {
      ctx.progress({ message: `Denoising the sound of ${f.name}` });
      await measureIo.denoised(src, clean, to, ctx.signal);
    }
    for (const m of here) {
      for (const denoised of o.denoise ? [false, true] : [false]) {
        if (ctx.signal.aborted) throw cancelled();
        const setup = speechSetup(machine, m.entry.id);
        if ("missing" in setup)
          throw new UserError(
            "The transcription engine is not on this PC.",
            "Install it in Settings › Models › Transcription (or: testimus models pullWhisper).",
          );
        const dir = join(work, `${docId}-${f.n}-${m.entry.id}`);
        rmSync(dir, { recursive: true, force: true });
        const memory = measureIo.memory(setup.model);
        try {
          const r = await transcribe(ctx, {
            src: denoised ? clean : src,
            dir,
            file: { ...f, range: { from, to } },
            duration: v.duration,
            tracks: v.tracks?.length ?? 1,
            spoken: (f.spoken ?? readProject(project).video?.spoken ?? []).map((l) => l.toLowerCase()),
            glossary,
            setup,
            force: true,
          });
          // ponytail: the sound is heard 20 s past the start of the reference's last sentence so that sentence is
          // whole, but what begins after it was never typed: it is not counted as words in excess
          const last = reference.at(-1)?.at ?? to;
          const heard = r.lines
            .filter((l) => l.at <= last + 2)
            .map((l) => l.text)
            .join(" ");
          const jargon = jargonRecall(glossary.kept, said, heard);
          const peak = memory.peakMB();
          rows.push({
            model: m.entry.id,
            label: m.entry.label,
            device: r.device,
            ...(denoised ? { denoised: true } : {}),
            jargon: jargon.said ? Math.round((jargon.right / jargon.said) * 100) / 100 : null,
            terms: jargon.said,
            wer: Math.round(wordErrorRate(words, comparable(heard)) * 1000) / 1000,
            timing: timingError(reference, r.lines),
            speed: r.tookMs > 0 ? Math.round(((to - from) / (r.tookMs / 1000)) * 10) / 10 : 0,
            seconds: Math.round(r.tookMs / 100) / 10,
            ...(peak !== null ? { memoryMB: peak } : {}),
            at,
          });
        } finally {
          await memory.stop().catch(() => {});
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    rmSync(clean, { force: true });
  }
  const ref = refOf(reference);
  const before = readMeasures(project, docId, f.n);
  const key = (r: Measure) => `${r.model} ${!!r.denoised}`;
  const fresh = new Set(rows.map(key));
  const kept =
    before?.ref === ref
      ? before.rows.filter((r) => !fresh.has(key(r))).map((r) => ({ ...r, at: r.at ?? before.at }))
      : [];
  const all = [...rows, ...kept].sort(best);
  const language = languageOf(project, f, v, from, to);
  const report: MeasureReport = {
    doc: docId,
    video: f.n,
    at,
    from,
    to,
    words: spoken(said).split(" ").filter(Boolean).length,
    ...(language ? { language } : {}),
    ref,
    rows: all,
    verdicts: verdictsOf(
      all,
      speechModels().map((m) => m.entry),
    ),
  };
  writeJson(reportFile(project, docId, f.n), report);
  return report;
}

export type VideoMeasures = {
  doc: string;
  video: number;
  name: string;
  language?: string;
  words: number;
  stale: boolean;
  measures: (Measure & { at: string })[];
};
export type LanguageMeasure = {
  language: string;
  model: string;
  label: string;
  videos: number;
  references: number;
  enough: boolean;
  words: number;
  wer: number;
  jargon?: number;
  terms: number;
};

// ponytail: the project's reference set — every video a person typed a reference for, with what each model made of
// it, and by language and model the figures over its videos: the words wrong over all the words said (each video
// weighs its reference's words), the terms written right over all the terms said. A language is a set once it has 3
// reference videos (3 to 5, a few minutes each): under that the figures are one recording's, and the page says so.
// A row heard through the denoiser stays on its video and out of the language's figures
export function projectMeasures(project: string): {
  videos: VideoMeasures[];
  byLanguage: LanguageMeasure[];
  notes: string[];
} {
  const videos: VideoMeasures[] = [];
  for (const d of listDocs(project).filter(isMediaDoc))
    for (const f of filesOf(d).filter((x) => x.kind === "video")) {
      const reference = readReference(project, d.id, f.n);
      if (!reference.length) continue;
      const v = readVideo(project, d.id, f.n);
      const report = readMeasures(project, d.id, f.n);
      const span = spanOf(reference, v?.duration ?? Number.MAX_SAFE_INTEGER);
      const language = languageOf(project, f, v, span.from, span.to) ?? report?.language;
      videos.push({
        doc: d.id,
        video: f.n,
        name: f.name,
        ...(language ? { language } : {}),
        words: spoken(reference.map((r) => r.text).join(" "))
          .split(" ")
          .filter(Boolean).length,
        stale: !!report?.ref && report.ref !== refOf(reference),
        measures: report ? report.rows.map((r) => ({ ...r, at: r.at ?? report.at })) : [],
      });
    }
  const sets = new Map<string, VideoMeasures[]>();
  for (const x of videos) sets.set(x.language ?? "unknown", [...(sets.get(x.language ?? "unknown") ?? []), x]);
  const byLanguage: LanguageMeasure[] = [];
  const notes: string[] = [];
  for (const [language, set] of sets) {
    if (set.length < REFERENCE_FLOOR)
      notes.push(
        `${spokenName(language)}: ${set.length} reference video${set.length > 1 ? "s" : ""}, where ${REFERENCE_FLOOR} to 5 are needed (a few minutes typed by hand in each) before a model is chosen on these figures.`,
      );
    const models = [...new Set(set.flatMap((x) => x.measures.filter((r) => !r.denoised).map((r) => r.model)))];
    for (const model of models) {
      const rows = set.flatMap((x) =>
        x.measures.filter((r) => r.model === model && !r.denoised).map((r) => ({ r, words: x.words })),
      );
      const words = rows.reduce((s, x) => s + x.words, 0);
      const terms = rows.reduce((s, x) => s + x.r.terms, 0);
      byLanguage.push({
        language,
        model,
        label: rows[0].r.label,
        videos: rows.length,
        references: set.length,
        enough: set.length >= REFERENCE_FLOOR,
        words,
        wer: words ? Math.round((rows.reduce((s, x) => s + x.r.wer * x.words, 0) / words) * 1000) / 1000 : 0,
        ...(terms
          ? { jargon: Math.round((rows.reduce((s, x) => s + (x.r.jargon ?? 0) * x.r.terms, 0) / terms) * 100) / 100 }
          : {}),
        terms,
      });
    }
  }
  return { videos, byLanguage, notes };
}
