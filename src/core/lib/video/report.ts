import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { env } from "../../env.ts";
import { momentOf, normalizeAnchor, parseAnchor } from "../../rag/anchors.ts";
import { moveSources, recheckMechanical, testsCiting } from "../check.ts";
import { docDir, readDoc, readFigures, writeFigures } from "../docs.ts";
import { frameAnchor, readVideo, writeMediaMd, writeVideo } from "../media-md.ts";
import { readJson, writeJson } from "../project.ts";
import { readTest } from "../store.ts";
import { relocate, resolveTimed, videoText } from "./sources.ts";

export type ReportRow = {
  test: string;
  step: number;
  from: string;
  quote: string;
  state: "holds" | "moved" | "lost";
  to?: string;
  nearest?: { anchor: string; text: string };
};
export type TranscriptReport = {
  doc: string;
  video: number;
  at: string;
  before: { with: string; at: string };
  holds: number;
  moved: number;
  lost: number;
  rows: ReportRow[];
};

export const reportFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.report.json`);

export function readReport(project: string, docId: string, n: number): TranscriptReport | null {
  return readJson<TranscriptReport | null>(reportFile(project, docId, n), null);
}

const ofVideo = (anchor: string, n: number) => {
  const a = parseAnchor(anchor);
  return (a.kind === "t" || a.kind === "v") && momentOf(a.id)?.n === n;
};

export const lostFile = (project: string, docId: string) => join(docDir(project, docId), "video", "lost.json");
const lostKey = (anchor: string, quote: string) => `${normalizeAnchor(anchor)}\n${quote}`;

// ponytail: the sources a report could not find again, by anchor and quote — the check then says « source-missing »
// for them (the video was heard or described again since), not that the quote was never there
export function readLost(project: string, docId: string): Set<string> {
  return new Set(readJson<string[]>(lostFile(project, docId), []));
}

// ponytail: before Claude describes key frames again, what it had written under them is kept — a test may quote it
// (v:…), and the report made afterwards finds each quote again or says which is lost
export function rememberSeen(project: string, docId: string, was: { anchor: string; text: string }[]): void {
  const byVideo = new Map<number, { at: number; text: string }[]>();
  for (const w of was) {
    const m = momentOf(parseAnchor(w.anchor).id);
    if (!m || !w.text.trim()) continue;
    byVideo.set(m.n, [...(byVideo.get(m.n) ?? []), { at: m.at, text: w.text }]);
  }
  for (const [n, frames] of byVideo) {
    const v = readVideo(project, docId, n);
    if (v && !v.seenBefore)
      writeVideo(project, docId, n, { ...v, seenBefore: { at: env.now().toISOString(), frames } });
  }
}

export function reportSeen(project: string, docId: string, videos: number[]): void {
  for (const n of videos) if (readVideo(project, docId, n)?.seenBefore) buildReport(project, docId, n);
}

// ponytail: what a new transcription did to the tests that cite the video. Most sources hold by themselves (same
// moment, same words: time does not move); for the others the quote is looked for within 15 s of where it was —
// found, the source follows it (moved); not found, the test will say so, with the nearest words and the moment to hear
// again (lost). Nothing is rewritten before a person applies the report, and the transcript before stays until then
export function buildReport(project: string, docId: string, n: number): TranscriptReport | null {
  const v = readVideo(project, docId, n);
  const md = join(docDir(project, docId), "doc.md");
  if ((!v?.before && !v?.seenBefore) || !existsSync(md)) return null;
  const doc = readDoc(project, docId);
  const vt = videoText(readFileSync(md, "utf8"));
  const names = new Set([doc.id, doc.code].filter(Boolean));
  const rows: ReportRow[] = [];
  for (const t of testsCiting(project, doc, (a) => ofVideo(a, n))) {
    const test = readTest(project, t.id).test;
    test.steps.forEach((s, i) => {
      for (const src of s.sources) {
        if (!src.anchor || !names.has(src.docId) || !ofVideo(src.anchor, n) || !src.quote.trim()) continue;
        const anchor = normalizeAnchor(src.anchor);
        const base = { test: t.id, step: i + 1, from: `${src.docId}#${anchor}`, quote: src.quote };
        const r = resolveTimed(vt, anchor, src.quote);
        if (r.ok) {
          rows.push(
            r.canonical === anchor
              ? { ...base, state: "holds" }
              : { ...base, state: "moved", to: `${src.docId}#${r.canonical}` },
          );
          continue;
        }
        const where = relocate(vt, anchor, src.quote);
        if ("anchor" in where) rows.push({ ...base, state: "moved", to: `${src.docId}#${where.anchor}` });
        else rows.push({ ...base, state: "lost", ...(where.nearest ? { nearest: where.nearest } : {}) });
      }
    });
  }
  const count = (s: ReportRow["state"]) => rows.filter((r) => r.state === s).length;
  // ponytail: frames described again that no test quotes need no report — what was written before is let go
  if (!v.before && !rows.some((r) => r.state !== "holds")) {
    const { seenBefore: _gone, ...rest } = v;
    writeVideo(project, docId, n, rest);
    rmSync(reportFile(project, docId, n), { force: true });
    return null;
  }
  const report: TranscriptReport = {
    doc: docId,
    video: n,
    at: env.now().toISOString(),
    before: v.before
      ? { with: v.before.with, at: v.before.at }
      : { with: "the descriptions before", at: v.seenBefore?.at ?? env.now().toISOString() },
    holds: count("holds"),
    moved: count("moved"),
    lost: count("lost"),
    rows,
  };
  writeJson(reportFile(project, docId, n), report);
  return report;
}

// ponytail: applying the report rewrites the sources that moved, checks the citing tests again (a lost source then
// shows as a finding on its step) and lets the transcript before go
export function applyReport(
  project: string,
  docId: string,
  n: number,
): { rewritten: { test: string; from: string; to: string }[]; lost: number; tests: string[] } {
  const report = buildReport(project, docId, n) ?? readReport(project, docId, n);
  const rewritten: { test: string; from: string; to: string }[] = [];
  const tests = new Set<string>();
  for (const row of report?.rows ?? []) tests.add(row.test);
  for (const test of tests) {
    const moves = new Map(
      (report?.rows ?? [])
        .filter((r) => r.test === test && r.state === "moved" && r.to)
        .map((r) => [`${r.from}\n${r.quote}`, (r.to as string).slice((r.to as string).indexOf("#") + 1)]),
    );
    if (!moves.size) continue;
    for (const m of moveSources(
      project,
      test,
      (src, anchor) => moves.get(`${src.docId}#${anchor}\n${src.quote}`) ?? null,
    ))
      rewritten.push({ test, ...m });
  }
  const v = readVideo(project, docId, n);
  if (v?.before || v?.seenBefore) {
    const { before: _gone, seenBefore: _seen, ...rest } = v;
    writeVideo(project, docId, n, rest);
  }
  const lost = (report?.rows ?? []).filter((r) => r.state === "lost");
  const others = [...readLost(project, docId)].filter((k) => !ofVideo(k.split("\n")[0], n));
  const mine = lost.map((r) => lostKey(r.from.slice(r.from.indexOf("#") + 1), r.quote));
  if (others.length || mine.length) writeJson(lostFile(project, docId), [...new Set([...others, ...mine])]);
  else rmSync(lostFile(project, docId), { force: true });
  rmSync(reportFile(project, docId, n), { force: true });
  if (tests.size) recheckMechanical(project, [...tests]);
  return { rewritten, lost: report?.lost ?? 0, tests: [...tests] };
}

// ponytail: going back on a new transcription — the transcript before is put back as it was; the pieces on disk are
// the new ones, so the next conversion asked for would hear the video again
export function undoTranscription(project: string, docId: string, n: number): boolean {
  const seen = readVideo(project, docId, n);
  if (seen?.seenBefore) {
    const was = new Map(seen.seenBefore.frames.map((f) => [frameAnchor(n, f.at), f.text]));
    writeFigures(
      project,
      docId,
      readFigures(project, docId).map((e) => (was.has(e.anchor) ? { ...e, description: was.get(e.anchor) ?? "" } : e)),
    );
    const { seenBefore: _gone, ...rest } = seen;
    writeVideo(project, docId, n, rest);
    writeMediaMd(project, docId);
    if (!seen.before) {
      rmSync(reportFile(project, docId, n), { force: true });
      return true;
    }
  }
  const v = readVideo(project, docId, n);
  if (!v?.before) return false;
  const { before, ...rest } = v;
  writeVideo(project, docId, n, {
    ...rest,
    transcript: before.transcript,
    transcribed: { ...(rest.transcribed ?? { at: before.at }), with: before.with, at: before.at },
  });
  rmSync(reportFile(project, docId, n), { force: true });
  rmSync(join(docDir(project, docId), "video", String(n), "transcript"), { recursive: true, force: true });
  return true;
}
