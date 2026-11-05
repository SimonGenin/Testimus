import type { GpuInfo } from "../../types.ts";
import type { LlamaDevice } from "./sources.ts";

// ponytail: the rules that tell a GPU models can use from one they cannot, and a discrete card from an integrated one,
// are llmfit's (github.com/AlexsJones/llmfit, MIT, © Alex Jones), each from a machine it got wrong: an integrated GPU's
// memory is the PC's own (counting it as VRAM counts the RAM twice), and Intel HD / UHD runs models slower than the
// processor beside it

const VIRTUAL = /remote display|basic display|basic render|virtual|parsec|citrix|hyper-v|microsoft/i;

export function vendorOf(name: string): GpuInfo["vendor"] {
  if (/nvidia|geforce|quadro|rtx/i.test(name)) return "nvidia";
  if (/amd|radeon/i.test(name)) return "amd";
  if (/intel|arc\b/i.test(name)) return "intel";
  return "other";
}

export function isVirtual(name: string): boolean {
  return VIRTUAL.test(name);
}

const tokens = (lower: string) => lower.split(/[^a-z0-9]+/).filter(Boolean);

// « Arc A770 », « Arc(TM) B580 », « Arc Pro A60M »: a discrete Arc names its A/B series code; no integrated one does
function arcProductCode(lower: string): boolean {
  return tokens(lower).some((t) => /^[ab]\d{2,3}m?$/.test(t));
}

// « Radeon 780M Graphics »: a bare three-digit model ending in M is AMD's integrated naming (discrete mobile says RX)
function amdMobileIgpu(lower: string): boolean {
  return lower.includes("radeon") && !lower.includes("rx") && tokens(lower).some((t) => /^\d{3}m$/.test(t));
}

export function isIntegrated(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("(integrated)") || amdMobileIgpu(lower)) return true;
  if (lower.includes("intel")) return !arcProductCode(lower);
  if (lower.includes("radeon") && lower.includes("graphics")) return !/rx |pro |vega| vii| w\d/.test(lower);
  return false;
}

// Intel HD / UHD and the 2nd–4th generation Core controllers: no useful compute for a model
export function isLegacyIgpu(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.includes("intel")) return false;
  if (lower.includes("hd graphics")) return true;
  return (
    lower.includes("graphics controller") &&
    /sandy ?bridge|ivy ?bridge|haswell|broadwell|2nd gen(eration)? core|3rd gen core|4th gen core/.test(lower)
  );
}

export const integrated = (g: GpuInfo): boolean => g.integrated ?? isIntegrated(g.name);
export const usable = (g: GpuInfo): boolean => !isVirtual(g.name) && !isLegacyIgpu(g.name);

export function normalizeName(name: string): string {
  return tokens(name.toLowerCase().replace(/\((tm|r|c)\)/g, " ")).join(" ");
}

// ponytail: an exact match first; else a containment match only when one candidate fits (« RTX 4090 » against both
// « RTX 4090 » and « RTX 4090 Ti » binds to neither)
export function matchName<T>(name: string, candidates: T[], nameOf: (c: T) => string): T | undefined {
  const target = normalizeName(name);
  if (!target) return undefined;
  const exact = candidates.find((c) => normalizeName(nameOf(c)) === target);
  if (exact) return exact;
  const partial = candidates.filter((c) => {
    const n = normalizeName(nameOf(c));
    return !!n && (n.includes(target) || target.includes(n));
  });
  return partial.length === 1 ? partial[0] : undefined;
}

export type GpuSources = {
  nvidia: GpuInfo[];
  wmi: { name: string; driver?: string }[];
  registry: Map<string, number>;
  llama: LlamaDevice[];
};

// ponytail: nvidia-smi is exact for NVIDIA; the registry gives the others' size; llama.cpp, when installed, is the only
// source of their free memory (and of a GPU WMI did not list) — it is the engine that will hold the model
export function mergeGpus(s: GpuSources): GpuInfo[] {
  const gpus: GpuInfo[] = [...s.nvidia];
  const registry = [...s.registry.entries()];
  for (const g of s.wmi) {
    if (isVirtual(g.name) || matchName(g.name, gpus, (x) => x.name)) continue;
    const vendor = vendorOf(g.name);
    if (vendor === "nvidia" && s.nvidia.length) continue;
    const vram = matchName(g.name, registry, ([desc]) => desc)?.[1] ?? null;
    gpus.push({
      name: g.name,
      vendor,
      ...(g.driver ? { driver: g.driver } : {}),
      vramTotalMB: vram,
      vramUsedMB: null,
      source: vram === null ? "wmi" : "registry",
    });
  }
  for (const d of s.llama) {
    if (isVirtual(d.name)) continue;
    const g = matchName(d.name, gpus, (x) => x.name);
    if (!g) {
      gpus.push({
        name: d.name,
        vendor: vendorOf(d.name),
        vramTotalMB: d.totalMB,
        vramUsedMB: Math.max(0, d.totalMB - d.freeMB),
        source: "llama.cpp",
      });
      continue;
    }
    if (g.source === "nvidia-smi" || g.vramUsedMB !== null) continue;
    g.vramTotalMB ??= d.totalMB;
    g.vramUsedMB = Math.max(0, g.vramTotalMB - d.freeMB);
    g.source = "llama.cpp";
  }
  return gpus.map((g) => ({ ...g, integrated: isIntegrated(g.name) }));
}

// The order models are placed in: a usable discrete GPU first (the largest), then an integrated one, the rest last
export function rankGpus(gpus: GpuInfo[]): GpuInfo[] {
  const rank = (g: GpuInfo) => (!usable(g) ? 2 : integrated(g) ? 1 : 0);
  return [...gpus].sort((a, b) => rank(a) - rank(b) || (b.vramTotalMB ?? -1) - (a.vramTotalMB ?? -1));
}

export function usableGpus(gpus: GpuInfo[]): GpuInfo[] {
  return rankGpus(gpus).filter(usable);
}
