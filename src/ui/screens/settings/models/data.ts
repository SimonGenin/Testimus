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
export type RagStatus = CommandOutput<"rag.status">;
export type Activation = RagStatus["activation"];

export const PACK_ORDER = ["quality", "balanced", "performance", "light"];

export function size(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.max(0, Math.round(mb))} MB`;
}

const SYSTEM: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

// ponytail: the same reading as the core's mainGpu and platformOf, kept here so the UI never imports node code
export function machineSummary(hw: Hardware): string[] {
  const platform = hw.system?.platform ?? "win32";
  const gpu = [...hw.gpus].sort((a, b) => (b.vramTotalMB ?? -1) - (a.vramTotalMB ?? -1))[0];
  const vram = gpu?.vramTotalMB
    ? `, ${size(gpu.vramTotalMB)}${gpu.vramUsedMB !== null ? ` (${size(gpu.vramTotalMB - gpu.vramUsedMB)} free)` : ""}`
    : "";
  return [
    `${SYSTEM[platform] ?? platform}${hw.system ? ` · ${hw.system.arch}` : ""}`,
    `${hw.cpu.model}, ${hw.cpu.threads} threads`,
    `${size(hw.ramTotalMB)} of memory, ${size(hw.ramFreeMB)} free`,
    gpu
      ? `${gpu.name}${vram}`
      : platform === "win32"
        ? "No GPU found: search runs on the processor"
        : "No GPU Testimus can use here: search runs on the processor",
  ];
}

export const FIT: Record<FitVerdict, { tone: BadgeTone; icon: IconName; word: string }> = {
  fits: { tone: "success", icon: "check-circle", word: "Fits" },
  tight: { tone: "warning", icon: "alert-triangle", word: "Tight" },
  "gpu-too-small": { tone: "warning", icon: "cpu", word: "Partly on the processor" },
  "ram-too-small": { tone: "danger", icon: "x-circle", word: "RAM too small" },
  unknown: { tone: "info", icon: "info", word: "Not measured" },
  untested: { tone: "warning", icon: "alert-triangle", word: "Untested here" },
  unsupported: { tone: "danger", icon: "x-circle", word: "Not supported here" },
};

export const STATE: Record<ModelState, { tone: BadgeTone; icon: IconName; word: string }> = {
  available: { tone: "neutral", icon: "download", word: "Not installed" },
  downloading: { tone: "info", icon: "download", word: "Downloading" },
  installed: { tone: "neutral", icon: "check", word: "Installed" },
  verified: { tone: "success", icon: "check-circle", word: "Verified" },
  active: { tone: "success", icon: "circle-dot", word: "In use" },
  broken: { tone: "danger", icon: "x-circle", word: "Broken" },
  outdated: { tone: "warning", icon: "clock", word: "Outdated" },
};

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

// ponytail: decision n°11 — the heaviest pack that fits without a GGUF or a reranker on the processor; Light when the
// hardware is unknown (no profile, or no RAM figure)
export function suggestPack(rows: PackRow[], hw: Hardware | null, catalog: CatalogRow[]): string {
  if (!hw?.ramTotalMB) return "light";
  const gguf = (id: string | null) => {
    const e = id ? catalog.find((c) => c.id === id) : undefined;
    return !!e && !e.runtimes.includes("transformers");
  };
  for (const id of PACK_ORDER) {
    const r = rows.find((p) => p.id === id);
    if (!r?.available || r.fit?.verdict !== "fits" || r.processorOnly) continue;
    if (r.fit.device === "cpu" && (gguf(r.embedding) || r.reranker)) continue;
    return r.id;
  }
  return "light";
}

type Picker = { pickFolder?: (o: { title: string; defaultPath?: string }) => Promise<string | null> };

// ponytail: the desktop shell's folder picker when it is there (SPEC §13 bridge); the browser mode types the path
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
