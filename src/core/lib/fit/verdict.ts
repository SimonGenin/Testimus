import { basename } from "node:path";
import type { CatalogEntry, Fit, FitVerdict, LoadedModel, MachineProfile, PerfLine } from "../../types.ts";
import { platformOf, systemName } from "../machine/profile.ts";
import { catalogEntry } from "../models-catalog.ts";
import { needOf } from "./need.ts";
import { deviceFor, gpuPool } from "./placement.ts";
import { unsupportedOn, untestedOn } from "./support.ts";

const ORDER: FitVerdict[] = ["fits", "unknown", "untested", "tight", "gpu-too-small", "ram-too-small", "unsupported"];

export const gb = (mb: number): string => `${(mb / 1024).toFixed(1)} GB`;

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

// Will these models run together on this PC? Each is placed (GPU or processor), its need taken from the most trusted
// source (need.ts), and the sums held against what the PC has free, keeping a margin (`headroom`) for the rest
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
  const keep = 1 - opts.headroom;
  const pool = onGpu.length ? gpuPool(machine) : null;
  const shared = !!pool?.shared;
  const ours = machine.loaded.filter((l) => isOurs(l, entries));
  const others = machine.loaded.filter((l) => !isOurs(l, entries));
  const vramNeed = Math.max(0, onGpu.reduce((a, i) => a + i.need.vram, 0) - ours.reduce((a, l) => a + l.vramMB, 0));
  const ramNeed = onCpu.reduce((a, i) => a + i.need.ram, 0) + (shared ? vramNeed : 0);
  const ramAll = items.reduce((a, i) => a + i.need.ram, 0);
  const vramTotal = pool?.totalMB ?? null;
  const vramFree = pool?.freeMB ?? null;
  const base = {
    device: onGpu.length ? ("gpu" as const) : ("cpu" as const),
    needMB: { vram: vramNeed, ram: ramNeed },
    freeMB: { vram: vramFree, ram: machine.ramFreeMB },
    totalMB: { vram: vramTotal, ram: machine.ramTotalMB },
  };
  const system = `${systemName(platformOf(machine))} ${machine.system?.arch ?? "x64"}`;
  const unsupported = entries.flatMap((e) => {
    const why = unsupportedOn(e, machine);
    return why ? [`${e.label} ${why}`] : [];
  });
  if (unsupported.length)
    return {
      verdict: "unsupported",
      ...base,
      unload: [],
      message: `Not supported on ${systemName(platformOf(machine))}: ${unsupported.join("; ")}.`,
    };
  const untested = entries.filter((e) => untestedOn(e, machine, opts.lines)).map((e) => e.label);
  const one = untested.length === 1;
  const proof = untested.length
    ? `Not proven on ${system}${machine.onnx ? ` (onnxruntime ${machine.onnx})` : ""}: ${untested.join(" and ")} ${one ? "has" : "have"} never run on this system, so ${one ? "it" : "they"} may not run at all; Testimus tries ${one ? "it" : "them"} right after the download and refuses ${one ? "it" : "them"} if ${one ? "it fails" : "one fails"}.`
    : "";
  const done = (verdict: FitVerdict, message: string, unload: string[] = []): Fit => ({
    verdict: proof ? worst(verdict, "untested") : verdict,
    ...base,
    unload,
    message: proof ? `${proof} Memory: ${message[0].toLowerCase()}${message.slice(1)}` : message,
  });

  const sharedNote = shared ? ` (${pool?.gpu.name} is integrated: it uses the PC's memory)` : "";
  if (ramNeed > machine.ramTotalMB)
    return done(
      "ram-too-small",
      `${labels} ${need} about ${gb(ramNeed)} of memory${sharedNote}; this PC has ${gb(machine.ramTotalMB)}. Choose a lighter one.`,
    );
  let ramVerdict: FitVerdict = "fits";
  let ramMsg = "";
  if (onCpu.length || shared) {
    if (ramNeed <= machine.ramFreeMB * keep)
      ramMsg = `${need} about ${gb(ramNeed)} of memory, ${gb(machine.ramFreeMB)} free`;
    else {
      ramVerdict = "tight";
      ramMsg = `${need} about ${gb(ramNeed)} of memory and this PC has ${gb(machine.ramFreeMB)} free (${gb(machine.ramFreeMB * keep)} usable with the ${Math.round(opts.headroom * 100)} % margin): close other programs`;
    }
  }
  if (shared)
    return done(
      ramVerdict,
      ramVerdict === "fits"
        ? `Fits on ${pool?.gpu.name}, which shares the PC's memory: ${labels} ${ramMsg}.`
        : `Tight on ${pool?.gpu.name}, which shares the PC's memory: ${labels} ${ramMsg}.`,
    );
  if (!onGpu.length)
    return done(
      ramVerdict,
      ramVerdict === "fits"
        ? `Fits on the processor${gpuPool(machine) ? "" : " (no GPU Testimus can use)"}: ${labels} ${ramMsg}.`
        : `Tight: ${labels} ${ramMsg}.`,
    );

  const gpu = pool?.gpu;
  if (vramTotal === null || vramFree === null)
    return done(
      ramVerdict === "tight" ? "tight" : "unknown",
      `Cannot check the memory of ${gpu?.name ?? "the GPU"}: try it; Testimus measures it on first use.${ramMsg ? ` On the processor side, ${ramMsg}.` : ""}`,
    );
  const freeNote = pool?.freeMeasured ? "" : " (free memory not measured on this GPU)";
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
