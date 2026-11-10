import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../../command.ts";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { momentOf } from "../../rag/anchors.ts";
import type { MediaFile, SpokenLine } from "../../types.ts";
import { writeAtomic } from "../atomic.ts";
import { docDir } from "../docs.ts";
import { machineProfile } from "../machine/profile.ts";
import { readVideo } from "../media-md.ts";
import { readProject, writeJson } from "../project.ts";
import { speechModels, speechSetup } from "./engine.ts";
import { speechGlossary } from "./glossary.ts";
import { spoken } from "./lines.ts";
import { transcribe } from "./speech.ts";

export type Measure = {
  model: string;
  label: string;
  device: "gpu" | "cpu";
  jargon: number | null;
  terms: number;
  wer: number;
  timing: number | null;
  speed: number;
};
export type MeasureReport = {
  doc: string;
  video: number;
  at: string;
  from: number;
  to: number;
  words: number;
  rows: Measure[];
};

export const referenceFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.reference.txt`);

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

// ponytail: the word error rate — the fewest words to replace, drop or add to turn what the engine wrote into what
// was said, over the words said; both sides without case nor punctuation (lines.ts spoken)
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

// ponytail: the models on this PC, each heard on the part of the video a person transcribed by hand, and held
// against it — the glossary's terms written right first (what a test quotes), then the word error rate, how far the
// anchors are, how fast it went. The default is chosen on these figures, not on public benchmarks. Nothing of the
// document is touched: each model works in a folder of its own, removed after
export async function measureSpeech(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  models?: string[],
): Promise<MeasureReport> {
  const reference = readReference(project, docId, f.n);
  const v = readVideo(project, docId, f.n);
  if (!reference.length || !v)
    throw new UserError(
      `${f.name} has no reference transcript.`,
      "Type a few minutes of what is said, a sentence a line, each starting with its moment ([02:36] …), in Documents › Video › Reference (or: testimus media reference <doc> --text …).",
    );
  const from = Math.max(0, reference[0].at - 2);
  const to = Math.min(v.duration, (reference.at(-1)?.at ?? from) + 20);
  const glossary = speechGlossary(project);
  const said = reference.map((r) => r.text).join(" ");
  const words = spoken(said).split(" ").filter(Boolean);
  const machine = await machineProfile().catch(() => null);
  const here = speechModels().filter((m) => m.path && (!models?.length || models.includes(m.entry.id)));
  if (!here.length)
    throw new UserError("No transcription model is on this PC.", "Install one in Settings › Models › Transcription.");
  const rows: Measure[] = [];
  for (const m of here) {
    if (ctx.signal.aborted) break;
    const setup = speechSetup(machine, m.entry.id);
    if ("missing" in setup)
      throw new UserError(
        "The transcription engine is not on this PC.",
        "Install it in Settings › Models › Transcription (or: testimus models pullWhisper).",
      );
    const dir = join(project, ".testimus", "measure", `${docId}-${f.n}-${m.entry.id}`);
    rmSync(dir, { recursive: true, force: true });
    try {
      const r = await transcribe(ctx, {
        src: join(docDir(project, docId), f.file),
        dir,
        file: { ...f, range: { from, to } },
        duration: v.duration,
        tracks: v.tracks?.length ?? 1,
        spoken: (f.spoken ?? readProject(project).video?.spoken ?? []).map((l) => l.toLowerCase()),
        glossary,
        setup,
        force: true,
      });
      const heard = r.lines.map((l) => l.text).join(" ");
      const jargon = jargonRecall(glossary.kept, said, heard);
      rows.push({
        model: m.entry.id,
        label: m.entry.label,
        device: r.device,
        jargon: jargon.said ? Math.round((jargon.right / jargon.said) * 100) / 100 : null,
        terms: jargon.said,
        wer: Math.round(wordErrorRate(words, spoken(heard).split(" ").filter(Boolean)) * 1000) / 1000,
        timing: timingError(reference, r.lines),
        speed: r.tookMs > 0 ? Math.round(((to - from) / (r.tookMs / 1000)) * 10) / 10 : 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const report: MeasureReport = {
    doc: docId,
    video: f.n,
    at: env.now().toISOString(),
    from,
    to,
    words: words.length,
    rows,
  };
  writeJson(join(project, "eval", "speech", `${docId}-${f.n}.json`), report);
  return report;
}
