import type { CommandOutput } from "../../../../core/commands/index.ts";
import type { FitVerdict, RagChoice } from "../../../../core/types.ts";
import type { BadgeTone } from "../../../components/ui/Badge.tsx";
import type { IconName } from "../../../components/ui/Icon.tsx";

export type ModelState = CommandOutput<"models.catalog">[number]["state"];
export type PackRow = CommandOutput<"models.packs">[number];
export type CatalogRow = CommandOutput<"models.catalog">[number];
export type Installed = CommandOutput<"models.list">[number];
export type UsePackOut = CommandOutput<"models.planPack">;
export type UsePlan = UsePackOut["plan"];
export type AdviceRow = CommandOutput<"models.advice">[number];
export type SetDirOut = CommandOutput<"models.planDir">;
export type Hardware = CommandOutput<"models.hardware">;
export type Speech = CommandOutput<"models.speech">;
export type SpeechModel = Speech["models"][number];
export type RagStatus = CommandOutput<"rag.status">;
export type Activation = RagStatus["activation"];

export function size(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.max(0, Math.round(mb))} MB`;
}

const SYSTEM: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

type Gpu = Hardware["gpus"][number];

function gpuMemory(g: Gpu): string {
  if (g.integrated) return ", integrated (uses the PC's memory)";
  if (!g.vramTotalMB) return "";
  return `, ${size(g.vramTotalMB)}${g.vramUsedMB !== null ? ` (${size(g.vramTotalMB - g.vramUsedMB)} free)` : ""}`;
}

// ponytail: models.hardware lists the GPUs in the order models are placed on them, so the first usable one is the
// core's mainGpu
export function mainGpuOf(hw: Hardware): Gpu | undefined {
  return hw.gpus.find((g) => g.usable !== false);
}

export function machineSummary(hw: Hardware): string[] {
  const platform = hw.system?.platform ?? "win32";
  const gpu = mainGpuOf(hw);
  return [
    `${SYSTEM[platform] ?? platform}${hw.system ? ` · ${hw.system.arch}` : ""}`,
    `${hw.cpu.model}, ${hw.cpu.threads} threads`,
    `${size(hw.ramTotalMB)} of memory, ${size(hw.ramFreeMB)} free`,
    gpu
      ? `${gpu.name}${gpuMemory(gpu)}`
      : platform === "win32" && !hw.gpus.length
        ? "No GPU found: search runs on the processor"
        : "No GPU Testimus can use here: search runs on the processor",
  ];
}

// Every graphics adapter with what Testimus does with it: the one the models run on, the others and why they are not
export function gpuFacts(hw: Hardware): { label: string; value: string }[] {
  const main = mainGpuOf(hw);
  if (!hw.gpus.length) return [{ label: "GPU", value: machineSummary(hw)[3] }];
  const rows = hw.gpus.map((g) => ({
    label: g === main ? "GPU" : "Other GPU",
    value: `${g.name}${gpuMemory(g)} — ${
      g === main
        ? "the models run on it"
        : g.usable === false
          ? "not used: slower than the processor for models"
          : "not used while the GPU above is there"
    }`,
  }));
  return main ? rows : [{ label: "GPU", value: machineSummary(hw)[3] }, ...rows];
}

type Vocab = { tone: BadgeTone; icon: IconName; label: string };

// ponytail: the closed vocabularies the core's states are shown with — a word, a tone and an icon each, spread on a
// Badge; the sentences come from the core
export const FIT: Record<FitVerdict, Vocab> = {
  fits: { tone: "success", icon: "check-circle", label: "Fits" },
  tight: { tone: "warning", icon: "alert-triangle", label: "Tight" },
  "gpu-too-small": { tone: "warning", icon: "cpu", label: "Partly on the processor" },
  "ram-too-small": { tone: "danger", icon: "alert-circle", label: "RAM too small" },
  unknown: { tone: "info", icon: "info", label: "Not measured" },
  untested: { tone: "warning", icon: "circle-dashed", label: "Untested here" },
  unsupported: { tone: "neutral", icon: "x-circle", label: "Not supported here" },
};

export const STATE: Record<ModelState, Vocab> = {
  available: { tone: "neutral", icon: "download", label: "Not installed" },
  downloading: { tone: "info", icon: "download", label: "Downloading" },
  installed: { tone: "neutral", icon: "check", label: "Installed" },
  verified: { tone: "success", icon: "check-circle", label: "Verified" },
  active: { tone: "success", icon: "circle-dot", label: "In use" },
  broken: { tone: "danger", icon: "x-circle", label: "Broken" },
  outdated: { tone: "warning", icon: "clock", label: "Outdated" },
};

export const INSTALLED: Record<PackRow["installed"], Vocab> = {
  all: { tone: "success", icon: "check", label: "Installed" },
  some: { tone: "warning", icon: "download", label: "Partly installed" },
  none: { tone: "neutral", icon: "download", label: "Not installed" },
};

export const NOT_IN_USE: Vocab = { tone: "neutral", icon: "circle-dashed", label: "Not in use" };
export const IN_USE: Vocab = { tone: "success", icon: "check", label: "In use" };
export const PROCESSOR_ONLY: Vocab = { tone: "warning", icon: "cpu", label: "Processor only" };
export const SUGGESTED: Vocab = { tone: "neutral", icon: "target", label: "Suggested for this PC" };
export const ADVISED: Vocab = { tone: "accent", icon: "target", label: "Advised for this PC" };

// ponytail: a transcription model's speed is seconds of video heard in a second — said as a factor, and as the time
// an hour of video takes
export function speedFactor(speed: number): string {
  return `× ${speed >= 10 ? Math.round(speed) : Math.round(speed * 10) / 10}`;
}

export function hourIn(speed: number): string {
  const minutes = 60 / speed;
  if (minutes < 1) return "an hour in under a minute";
  if (minutes >= 90) return `an hour in about ${Math.round(minutes / 6) / 10} h`;
  return `an hour in about ${Math.round(minutes)} min`;
}

// ponytail: the memory a model takes where it runs here, beside what is free there — the short form of fit.message
export function fitMemory(fit: SpeechModel["fit"]): string {
  const onCard = fit.device === "gpu";
  const need = onCard ? fit.needMB.vram : fit.needMB.ram;
  const free = onCard ? fit.freeMB.vram : fit.freeMB.ram;
  return `${size(need)} ${onCard ? "on the card" : "of memory"}${free === null ? "" : `, ${size(free)} free`}`;
}

export const ORIGIN: Record<Activation, string> = {
  machine: "This PC's choice",
  reference: "The team reference",
  light: "The Light pack (default)",
  none: "None: lexical search only",
};

export const isInstalled = (s: ModelState) => s === "installed" || s === "verified" || s === "active";

export function choiceLabel(c: RagChoice | undefined | null, label: (id: string) => string): string {
  if (!c) return "Not set";
  if ("pack" in c) return `${c.pack.charAt(0).toUpperCase()}${c.pack.slice(1)} pack`;
  return c.reranker ? `${label(c.embedding)} + ${label(c.reranker)}` : label(c.embedding);
}

type Picker = { pickFolder?: (o: { title: string; defaultPath?: string }) => Promise<string | null> };

// ponytail: the desktop shell's folder picker when it is there; the browser mode types the path
export function folderPicker(): Picker["pickFolder"] | null {
  const bridge = (globalThis as { testimusDesktop?: Picker }).testimusDesktop;
  return bridge?.pickFolder ? (o) => bridge.pickFolder?.(o) ?? Promise.resolve(null) : null;
}

export function defaultFolder(root: string): string {
  if (root.startsWith("/")) return `${root.replace(/\/+$/, "")}/Testimus/models`;
  return `${root.replace(/[\\/]+$/, "")}\\Testimus\\models`;
}

export function onDrive(dir: string, root: string): boolean {
  if (root.startsWith("/")) {
    const base = root.replace(/\/+$/, "");
    return dir === base || dir.startsWith(`${base}/`);
  }
  return /^[a-zA-Z]:[\\/]/.exec(dir)?.[0].replace("/", "\\").toUpperCase() === root.toUpperCase();
}

// ponytail: mapped network shares of one server report the same free and total figures — a drive whose figures
// repeat is not preselected (a models folder on a share is slow); BESOIN: models.hardware drive kind
export function bestDrive(drives: Hardware["drives"], needMB: number, systemRoot = "C:\\"): string | null {
  const same = (d: Hardware["drives"][number]) =>
    drives.filter((x) => x.freeMB === d.freeMB && x.totalMB === d.totalMB).length > 1;
  const room = drives.filter((d) => d.freeMB >= needMB * 1.2);
  const pick = (list: Hardware["drives"]) => [...list].sort((a, b) => b.freeMB - a.freeMB)[0]?.root ?? null;
  return (
    pick(room.filter((d) => !same(d) && d.root.toUpperCase() !== systemRoot.toUpperCase())) ??
    pick(room.filter((d) => !same(d))) ??
    pick(room)
  );
}
