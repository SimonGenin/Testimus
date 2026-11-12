import type { DocRef, DocStage, StageStep } from "../../core/types.ts";
import type { BadgeProps } from "../components/ui/Badge.tsx";
import { plural } from "./format.ts";

export type StageWord = Pick<BadgeProps, "label" | "tone" | "icon" | "busy" | "tooltip">;

type Known = Pick<DocRef, "indexed" | "converted" | "indexing"> & Partial<Pick<DocRef, "stage" | "pending">>;

// ponytail: docs.list says each document's stage; a document known otherwise (a read of another shape, a test's own)
// gets the stage at rest its index state gives
export function stageOf(d: Known): DocStage {
  if (d.stage) return d.stage;
  if (d.pending) return { name: "pending" };
  if (!d.converted?.at) return { name: "not-converted" };
  if (d.indexing?.state === "running") return { name: "indexing", percent: d.indexing.percent };
  if (d.indexing) return { name: "waiting-index" };
  return d.indexed === "missing"
    ? { name: "not-indexed" }
    : d.indexed === "stale"
      ? { name: "stale" }
      : { name: "ready" };
}

const CONVERTING: Partial<Record<StageStep, string>> = {
  text: "Converting the text",
  figures: "Describing the figures",
  pictures: "Reading the pictures",
  transcribing: "Transcribing",
  frames: "Looking at the frames",
  checking: "Checking the citing tests",
};

const FAILED: Partial<Record<StageStep, string>> = {
  copy: "Copy failed",
  convert: "Conversion failed",
  index: "Indexing failed",
};

const size = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${Math.round(bytes / 1e6)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

const pct = (s: DocStage) => (s.percent !== undefined ? ` · ${s.percent} %` : "");

// ponytail: the words of a stage, the same everywhere a document's stage is shown (DocStage): a state is icon + word,
// a stage under way spins
export function stageWord(s: DocStage): StageWord {
  switch (s.name) {
    case "pending":
      return {
        label: "Waiting to start",
        tone: "neutral",
        icon: "pause",
        ...(s.bytes ? { tooltip: `${size(s.bytes)} to copy once started` } : {}),
      };
    case "copying":
      return s.step === "waiting"
        ? { label: "Waiting to copy", tone: "neutral", icon: "clock" }
        : { label: `Copying${pct(s)}`, tone: "info", busy: true };
    case "not-converted":
      return { label: "Not converted", tone: "info", icon: "file" };
    case "converting":
      return s.step === "waiting"
        ? { label: "Waiting to convert", tone: "neutral", icon: "clock" }
        : { label: `${(s.step && CONVERTING[s.step]) || "Converting"}${pct(s)}`, tone: "info", busy: true };
    case "waiting-index":
      return {
        label: s.before ? `Waiting to index · ${plural(s.before, "document")} before` : "Waiting to index",
        tone: "neutral",
        icon: "clock",
      };
    case "indexing":
      return { label: `Indexing · ${s.percent ?? 0} %`, tone: "info", busy: true };
    case "not-indexed":
      return { label: "Not indexed", tone: "danger", icon: "alert-circle" };
    case "ready":
      return { label: "Indexed", tone: "success", icon: "check" };
    case "stale":
      return { label: "Not up to date", tone: "warning", icon: "alert-triangle" };
    case "failed":
      return {
        label: FAILED[s.step ?? "convert"] ?? "Failed",
        tone: "danger",
        icon: "x-circle",
        ...(s.message ? { tooltip: s.message } : {}),
      };
  }
}

// ponytail: what the page started and docs.list does not say yet (an add, a conversion, an index run it asked for) —
// its job's row stands for the stage until the list catches up
export function stageWith(d: Known, u?: { phase: string; pct: number | null; message?: string }): DocStage {
  const s = stageOf(d);
  if (!u || moving(s)) return s;
  const percent = u.pct !== null ? { percent: u.pct } : {};
  if (u.phase === "waiting") return { name: "converting", step: "waiting" };
  if (u.phase === "converting") return { name: "converting", ...percent };
  if (u.phase === "adding" || u.phase === "reading") return { name: "copying", ...percent };
  if (u.phase === "indexing")
    return u.message?.startsWith("Waiting") ? { name: "waiting-index" } : { name: "indexing", percent: u.pct ?? 0 };
  return s;
}

// ponytail: a stage that moves on its own (a copy, a conversion, an index pass under way or waited for)
export const moving = (s: DocStage) =>
  s.name === "copying" || s.name === "converting" || s.name === "waiting-index" || s.name === "indexing";
