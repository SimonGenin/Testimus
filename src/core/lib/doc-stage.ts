import { listJobs } from "../jobs.ts";
import type { DocRef, DocStage, Job, StageStep } from "../types.ts";
import { isConverted } from "./docs.ts";
import { waitingBefore } from "./docs-index.ts";
import { bytesOf, copyOf } from "./docs-pending.ts";
import { sourceType } from "./media.ts";

const LOOKING = /Looking through|key frames|lighter copy/;

const runningStep = (j: Job) => j.steps?.find((s) => s.status === "running");

// ponytail: the part of a conversion a document is in, by its type — a Word or PDF document's text then its figures,
// the pictures of an images document (prepared, then read by Claude), a video heard then looked through (the job's own
// line tells which); re-checking the citing tests and the triage close every kind
function convertingStep(d: DocRef, j: Job): StageStep {
  const step = runningStep(j)?.id;
  if (step === "queue") return "waiting";
  if (step === "cited" || step === "triage") return "checking";
  const t = sourceType(d);
  if (t === "docx" || t === "pdf" || t === "txt") return step === "figures" ? "figures" : "text";
  if (t === "images") return "pictures";
  if (step === "read") return "frames";
  const line = runningStep(j)?.message ?? j.message ?? "";
  return LOOKING.test(line) ? "frames" : "transcribing";
}

const counted = (j: Job) => {
  const s = runningStep(j);
  const p = s?.total ? { done: s.done ?? 0, total: s.total } : j.progress;
  return p?.total ? { done: p.done, total: p.total, percent: Math.floor((p.done / p.total) * 100) } : {};
};

function indexStage(d: DocRef, before: number | null): DocStage {
  if (d.indexing?.state === "running")
    return {
      name: "indexing",
      percent: d.indexing.percent,
      ...(d.indexing.total ? { done: d.indexing.done, total: d.indexing.total } : {}),
    };
  return { name: "waiting-index", ...(before !== null ? { before } : {}) };
}

// ponytail: the one place a document's stage is worked out (docs.list): pending until started (copying while a start
// copies it, failed with the copy's reason); then the conversion job running for it (its step, by type), the index pass
// it waits for or that reads it; at rest: not converted (or its last conversion failed), ready when search reads its
// current text, stale when the index no longer follows it, not indexed (or failed, when the last index run failed)
export function stageOf(
  project: string,
  d: DocRef,
  o: { running?: Job; lastConvert?: Job; lastIndex?: Job; before: number | null },
): DocStage {
  if (d.pending) {
    const c = copyOf(project, d.id);
    if (c?.queued) return { name: "copying", step: "waiting", done: 0, total: c.total };
    if (c)
      return {
        name: "copying",
        done: c.done,
        total: c.total,
        percent: c.total ? Math.floor((c.done / c.total) * 100) : 0,
      };
    if (d.pending.failed) return { name: "failed", step: "copy", message: d.pending.failed };
    return { name: "pending", bytes: bytesOf(d) };
  }
  const j = o.running;
  if (j) {
    if (runningStep(j)?.id === "index") return indexStage(d, o.before);
    const step = convertingStep(d, j);
    return { name: "converting", step, ...(step === "waiting" ? {} : counted(j)) };
  }
  if (d.indexing && isConverted(d)) return indexStage(d, null);
  if (!isConverted(d)) {
    const last = o.lastConvert;
    return last?.status === "failed"
      ? { name: "failed", step: "convert", message: last.error ?? "The conversion failed." }
      : { name: "not-converted" };
  }
  if (d.indexed === "fresh") return { name: "ready" };
  if (d.indexed === "stale") return { name: "stale" };
  const ix = o.lastIndex;
  if (ix?.status === "failed" && ix.startedAt >= (d.converted?.at ?? ""))
    return { name: "failed", step: "index", message: ix.error ?? "The index run failed." };
  return { name: "not-indexed" };
}

const INDEX = /^rag-index$|^rag\.index$/;

// ponytail: the jobs are read once for the whole list — the conversion running for each document, its last one ended,
// and the last index run ended
export function withStages(project: string, docs: DocRef[]): (DocRef & { stage: DocStage })[] {
  const jobs = listJobs(project);
  const running = new Map<string, Job>();
  const ended = new Map<string, Job>();
  let lastIndex: Job | undefined;
  for (const j of jobs) {
    if (j.kind === "docs.convert") {
      if (j.status === "running") {
        if (!running.has(j.subject)) running.set(j.subject, j);
      } else if (!ended.has(j.subject)) ended.set(j.subject, j);
    } else if (!lastIndex && INDEX.test(j.kind) && j.status !== "running") lastIndex = j;
  }
  const before = waitingBefore(project);
  return docs.map((d) => ({
    ...d,
    stage: stageOf(project, d, { running: running.get(d.id), lastConvert: ended.get(d.id), lastIndex, before }),
  }));
}
