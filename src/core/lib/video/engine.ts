import { existsSync } from "node:fs";
import type { CatalogEntry, Fit, MachineProfile, PerfLine } from "../../types.ts";
import { deviceFor } from "../fit/placement.ts";
import { fitOf } from "../fit/verdict.ts";
import { catalog } from "../models-catalog.ts";
import { perfStats, readPerf } from "../models-perf.ts";
import { budgets } from "../models-registry.ts";
import { resolveInstalled } from "../models-resolve.ts";
import { readSettings } from "../project.ts";
import { installedWhisper } from "../whisper.ts";
import { speechThreads } from "./io.ts";

export const SPEECH_DEFAULT = "whisper-large-v3-turbo-q8";

export type SpeechModel = { entry: CatalogEntry; path: string | null };
export type SpeechSetup = {
  entry: CatalogEntry;
  model: string;
  gpu: boolean;
  threads: number;
  engine: string;
};

// ponytail: the transcription models are the catalog's speech entries, best first (large-v3 turbo, then small for a
// modest PC); one is here when its file is on this PC — never downloaded by a conversion on its own (the user decides
// where big files go)
export function speechModels(): SpeechModel[] {
  return catalog()
    .entries.filter((e) => e.kind === "speech")
    .map((entry) => {
      const path = resolveInstalled(entry.id)?.install.path;
      return { entry, path: path && existsSync(path) ? path : null };
    });
}

// ponytail: the model this PC transcribes with — the one chosen in Settings › Models › Transcription (settings.json
// models.speech, a choice of this PC: it depends on its processor and card), else the best one installed
export function activeSpeech(): SpeechModel | null {
  const here = speechModels().filter((m) => m.path);
  const chosen = readSettings().models.speech;
  return here.find((m) => m.entry.id === chosen) ?? here[0] ?? null;
}

export function speechSetup(
  machine: MachineProfile | null,
  model?: string,
): SpeechSetup | { missing: "engine" | "model" } {
  const w = installedWhisper();
  if (!w) return { missing: "engine" };
  const m = model ? speechModels().find((x) => x.entry.id === model) : activeSpeech();
  if (!m?.path) return { missing: "model" };
  return {
    entry: m.entry,
    model: m.path,
    gpu: w.backend === "cuda" && deviceFor(m.entry, machine) === "gpu",
    threads: speechThreads(machine?.cpu.threads),
    engine: `whisper.cpp ${w.build} ${w.backend}`,
  };
}

// ponytail: how many seconds of sound a model transcribes in a second on this PC — what its last runs here measured
// (the journal of timings), else a careful guess from the measures of 2026-11-10 (large-v3 turbo ×4 on 8 processor
// threads, ×30 on an NVIDIA card; small about twice that on a processor), scaled to this PC's threads
export function speechSpeed(
  entry: CatalogEntry,
  device: "gpu" | "cpu",
  threads: number,
  lines?: PerfLine[],
): { speed: number; measured: boolean } {
  const stat = perfStats({
    model: entry.id,
    last: 20,
    lines: (lines ?? readPerf()).filter((l) => l.op === "speech"),
  }).find((s) => s.device === device && s.count > 0 && s.perSecond > 0);
  if (stat) return { speed: stat.perSecond, measured: true };
  const light = entry.tier === "light";
  if (device === "gpu") return { speed: light ? 40 : 30, measured: false };
  return { speed: Math.round((light ? 7 : 4) * (Math.min(8, threads) / 8) * 10) / 10, measured: false };
}

export type SpeechAdvice = {
  id: string;
  fit: Fit;
  device: "gpu" | "cpu";
  speed: number;
  measured: boolean;
  recommended: boolean;
};

// ponytail: which model this PC should transcribe with — the best one that fits its memory and runs at least twice as
// fast as the sound; else the lighter one
export function speechAdvice(
  machine: MachineProfile,
  backend: "cuda" | "cpu" | null,
  lines?: PerfLine[],
): SpeechAdvice[] {
  const headroom = budgets().headroom;
  const threads = speechThreads(machine.cpu.threads);
  const rows = speechModels().map(({ entry }) => {
    const placed = deviceFor(entry, machine);
    const device = placed === "gpu" && backend !== "cpu" ? "gpu" : "cpu";
    const fit = fitOf([entry], machine, { headroom, lines });
    return {
      id: entry.id,
      fit,
      device,
      ...speechSpeed(entry, device, threads, lines),
      recommended: false,
    } as SpeechAdvice;
  });
  const ok = (r: SpeechAdvice) => (r.fit.verdict === "fits" || r.fit.verdict === "tight") && r.speed >= 2;
  const pick = rows.find(ok) ?? rows.at(-1);
  if (pick) pick.recommended = true;
  return rows;
}
