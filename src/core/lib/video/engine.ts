import { existsSync } from "node:fs";
import type { CatalogEntry, Fit, MachineProfile, PerfLine } from "../../types.ts";
import { needOf } from "../fit/need.ts";
import { deviceFor, gpuPool } from "../fit/placement.ts";
import { fitOf, gb } from "../fit/verdict.ts";
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

export type SpeechRoom = { entry: CatalogEntry; gpu: boolean; note?: string } | { entry: null; note: string };

// ponytail: the memory is looked at before a model is loaded, with what the fit of the search models goes by (what the
// model took here, else the catalog's figure, held against what is free now). A model that does not fit on the card
// but fits in memory is heard on the processor; one that fits nowhere gives way to the heaviest lighter model
// installed that does; when nothing fits there is no transcript — said plainly, rather than an engine that dies
// loading. A card whose free memory nobody can read is tried
export function speechRoom(
  wanted: CatalogEntry,
  lighter: CatalogEntry[],
  machine: MachineProfile,
  o: { gpu: boolean; lines?: PerfLine[] },
): SpeechRoom {
  const pool = o.gpu ? gpuPool(machine) : null;
  const card = pool && !pool.shared ? pool.freeMB : null;
  const ram = machine.ramFreeMB;
  const place = (e: CatalogEntry): "gpu" | "cpu" | null => {
    const need = needOf(e, o.lines);
    if (o.gpu && (card === null || need.vram <= card)) return "gpu";
    return need.ram <= ram ? "cpu" : null;
  };
  const need = needOf(wanted, o.lines);
  const onCard = card === null ? "" : `about ${gb(need.vram)} on the graphics card (${gb(card)} free there)`;
  const first = place(wanted);
  if (first === "gpu" || (first === "cpu" && !o.gpu)) return { entry: wanted, gpu: first === "gpu" };
  if (first === "cpu")
    return {
      entry: wanted,
      gpu: false,
      note: `${wanted.label} needs ${onCard}: the video is heard on the processor, several times slower. Close what uses the card to hear the next one faster.`,
    };
  const short = `${wanted.label} needs ${onCard ? `${onCard} or ` : ""}about ${gb(need.ram)} of memory, and this PC has ${gb(ram)} free`;
  for (const e of lighter) {
    const at = place(e);
    if (at)
      return {
        entry: e,
        gpu: at === "gpu",
        note: `${short}: the video is heard with ${e.label}, the lighter model. Close other programs and hear it again (testimus media retranscribe) for the better one.`,
      };
  }
  return {
    entry: null,
    note: `${short}, so the video has no transcript. Close other programs, or install a lighter model in Settings › Models › Transcription, then convert the document again.`,
  };
}

// ponytail: the setup a video is really heard with on this PC now — the one chosen, moved to the processor or to a
// lighter installed model when the memory free at this moment asks for it (speechRoom); without a machine profile
// nothing can be checked and the setup is tried as it is
export function speechFit(
  setup: SpeechSetup,
  machine: MachineProfile | null,
  lines: PerfLine[] = readPerf(),
): { setup: SpeechSetup | null; note?: string } {
  if (!machine) return { setup };
  const ram = (e: CatalogEntry) => needOf(e, lines).ram;
  const lighter = speechModels()
    .filter((m) => m.path && ram(m.entry) < ram(setup.entry))
    .sort((a, b) => ram(b.entry) - ram(a.entry));
  const room = speechRoom(
    setup.entry,
    lighter.map((m) => m.entry),
    machine,
    { gpu: setup.gpu, lines },
  );
  if (!room.entry) return { setup: null, note: room.note };
  const model = lighter.find((m) => m.entry.id === room.entry.id)?.path ?? setup.model;
  return { setup: { ...setup, entry: room.entry, model, gpu: room.gpu }, ...(room.note ? { note: room.note } : {}) };
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
