import { basename } from "node:path";
import type { CatalogEntry, Fit, FitVerdict, LoadedModel, MachineProfile, PerfLine } from "../types.ts";
import { catalogEntry } from "./models-catalog.ts";
import { mainGpu } from "./models-hardware.ts";
import { measuredMB } from "./models-perf.ts";

const ORDER: FitVerdict[] = ["fits", "unknown", "tight", "gpu-too-small", "ram-too-small"];

export const gb = (mb: number): string => `${(mb / 1024).toFixed(1)} GB`;

export function needOf(entry: CatalogEntry, lines?: PerfLine[]): { vram: number; ram: number } {
  const measured = measuredMB(entry.id, lines);
  const estimate = Math.round(entry.size.downloadMB * 1.2);
  return {
    vram: measured.vram ?? (entry.size.vramMB || estimate),
    ram: measured.ram ?? (entry.size.ramMB || estimate),
  };
}

export function deviceFor(entry: CatalogEntry, machine: MachineProfile): "gpu" | "cpu" {
  if (!entry.devices.includes("gpu") || !mainGpu(machine)) return "cpu";
  const gguf = entry.runtimes.includes("llamacpp");
  if (!gguf && !entry.dtypeByDevice?.dml) return "cpu";
  return "gpu";
}

// ponytail: a model already loaded for the pair being judged is not « other »: it would not unload itself
function isOurs(l: LoadedModel, entries: CatalogEntry[]): boolean {
  const name = l.name.toLowerCase();
  return entries.some(
    (e) => name === e.id || (!!e.source.hf?.path && name === basename(e.source.hf.path).toLowerCase()),
  );
}

const heldBy = (l: LoadedModel) => `llama.cpp holds ${catalogEntry(l.name)?.label ?? l.name}, ${gb(l.vramMB)}`;

export function worst(a: FitVerdict, b: FitVerdict): FitVerdict {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

export function fitOf(
  entries: CatalogEntry[],
  machine: MachineProfile,
  opts: { headroom: number; lines?: PerfLine[] },
): Fit {
  const items = entries.map((e) => ({ e, device: deviceFor(e, machine), need: needOf(e, opts.lines) }));
  const labels = entries.map((e) => e.label).join(" + ") || "nothing";
  const need = entries.length > 1 ? "need" : "needs";
  const onGpu = items.filter((i) => i.device === "gpu");
  const onCpu = items.filter((i) => i.device === "cpu");
  const ramNeed = onCpu.reduce((a, i) => a + i.need.ram, 0);
  const ramAll = items.reduce((a, i) => a + i.need.ram, 0);
  const keep = 1 - opts.headroom;
  const gpu = mainGpu(machine);
  const ours = machine.loaded.filter((l) => isOurs(l, entries));
  const others = machine.loaded.filter((l) => !isOurs(l, entries));
  const vramNeed = Math.max(0, onGpu.reduce((a, i) => a + i.need.vram, 0) - ours.reduce((a, l) => a + l.vramMB, 0));
  const vramTotal = onGpu.length ? (gpu?.vramTotalMB ?? null) : null;
  const vramFree = vramTotal === null ? null : vramTotal - (gpu?.vramUsedMB ?? 0);
  const base = {
    device: onGpu.length ? ("gpu" as const) : ("cpu" as const),
    needMB: { vram: vramNeed, ram: ramNeed },
    freeMB: { vram: vramFree, ram: machine.ramFreeMB },
    totalMB: { vram: vramTotal, ram: machine.ramTotalMB },
  };
  const done = (verdict: FitVerdict, message: string, unload: string[] = []): Fit => ({
    verdict,
    ...base,
    unload,
    message,
  });

  if (ramNeed > machine.ramTotalMB)
    return done(
      "ram-too-small",
      `${labels} ${need} about ${gb(ramNeed)} of memory; this PC has ${gb(machine.ramTotalMB)}. Choose a lighter one.`,
    );
  let ramVerdict: FitVerdict = "fits";
  let ramMsg = "";
  if (onCpu.length) {
    if (ramNeed <= machine.ramFreeMB * keep)
      ramMsg = `needs about ${gb(ramNeed)} of memory, ${gb(machine.ramFreeMB)} free`;
    else {
      ramVerdict = "tight";
      ramMsg = `needs about ${gb(ramNeed)} of memory and this PC has ${gb(machine.ramFreeMB)} free (${gb(machine.ramFreeMB * keep)} usable with the ${Math.round(opts.headroom * 100)} % margin): close other programs`;
    }
  }
  if (!onGpu.length)
    return done(ramVerdict, ramVerdict === "fits" ? `Fits: ${labels} ${ramMsg}.` : `Tight: ${labels} ${ramMsg}.`);

  if (vramTotal === null || vramFree === null)
    return done(
      ramVerdict === "tight" ? "tight" : "unknown",
      `Cannot check the memory of ${gpu?.name ?? "the GPU"}: try it; Testimus measures it on first use.${ramMsg ? ` On the processor side, ${ramMsg}.` : ""}`,
    );
  const freeNote = gpu?.vramUsedMB === null ? " (free memory not measured on this GPU)" : "";
  const gpuHas = `the GPU has ${gb(vramTotal)}, ${gb(vramFree)} free${freeNote}`;
  const has = `Your GPU has ${gb(vramTotal)}, ${gb(vramFree)} free${freeNote}.`;
  if (vramNeed > vramTotal) {
    if (ramAll > machine.ramTotalMB)
      return done(
        "ram-too-small",
        `${has} ${labels} ${need} about ${gb(vramNeed)}, and ${gb(ramAll)} of memory on the processor; this PC has ${gb(machine.ramTotalMB)}.`,
      );
    return done(
      "gpu-too-small",
      `${has} ${labels} ${need} about ${gb(vramNeed)}: it will run partly on the processor, several times slower.`,
    );
  }
  const usable = vramFree * keep;
  const tail = ramVerdict === "tight" ? ` On the processor side, ${ramMsg}.` : "";
  if (vramNeed <= usable)
    return done(ramVerdict, `Fits: ${labels} ${need} about ${gb(vramNeed)}; ${gpuHas} (${gb(usable)} usable).${tail}`);
  const othersMB = others.reduce((a, l) => a + l.vramMB, 0);
  if (others.length && vramNeed <= (vramFree + othersMB) * keep)
    return done(
      "tight",
      `Tight — ${others.map(heldBy).join("; ")}. ${labels} ${need} about ${gb(vramNeed)}; ${gb(vramFree)} free now.${tail}`,
      others.map((l) => l.name),
    );
  if (vramNeed <= vramFree)
    return done(
      "tight",
      `Tight: ${labels} ${need} about ${gb(vramNeed)}; ${gpuHas} (${gb(usable)} usable with the ${Math.round(opts.headroom * 100)} % margin).${tail}`,
    );
  return done(
    "tight",
    `Tight: ${labels} ${need} about ${gb(vramNeed)}; ${gpuHas}. Other programs use ${gb(vramTotal - vramFree)}: close them, or it runs partly on the processor.${tail}`,
    others.map((l) => l.name),
  );
}
