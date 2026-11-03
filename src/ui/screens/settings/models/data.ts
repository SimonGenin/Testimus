import type { Fit, FitVerdict, MachineProfile, RagChoice } from "../../../../core/types.ts";
import type { BadgeTone, IconName } from "../../../components/ui/index.ts";

export type ModelState = "available" | "downloading" | "installed" | "verified" | "active" | "broken" | "outdated";

export type PackRow = {
  suggested?: boolean;
  id: string;
  label: string;
  intent: string;
  active: boolean;
  available: boolean;
  variant: number | null;
  embedding: string | null;
  reranker: string | null;
  fit: Fit | null;
  skipped: string[];
  downloadMB: number;
  speed?: string;
  quality: string;
  measuredHere: boolean;
  projectQuality?: string;
  processorOnly?: boolean;
};

export type CatalogRow = {
  id: string;
  kind: "embedding" | "reranker";
  label: string;
  tier: string;
  runtimes: string[];
  quantization: string;
  dims: number;
  sizeMB: number;
  state: ModelState;
  fit: Fit;
};

export type Installed = {
  model: string;
  label: string;
  via: "path" | "download";
  runtime: string;
  where: string;
  sizeMB: number;
  state: ModelState;
  usedBy: string[];
  perf?: string;
};

export type UsePlan = {
  download: { model: string; sizeMB: number }[];
  dir: string | null;
  reindex: boolean;
  expected: string;
};

export type UsePackOut = {
  pack: string;
  variant: number;
  embedding: string;
  reranker: string | null;
  plan: UsePlan;
  jobIds: string[];
  dryRun: boolean;
};

export type AdviceRow = {
  id: string;
  direction: "upgrade" | "downgrade";
  from: RagChoice;
  to: RagChoice;
  reason: string;
  quality: string;
};

export type SetDirOut = {
  dir: string;
  drive: { root: string; freeMB: number };
  installedMB: number;
  action: "set" | "move" | "keep" | "copy";
  files: number;
  jobId?: string;
  dryRun: boolean;
};

export type Hardware = MachineProfile;

export type Activation = "machine" | "reference" | "project" | "light" | "none";

export type RagStatus = {
  embedding: string;
  reranker: string | null;
  dims: number;
  activation: Activation;
  missing: string[];
  exists: boolean;
  indexEmbedding: string | null;
  profileMatches: boolean;
  space: { id: string; vectors: number; complete: boolean } | null;
  degraded: string | null;
  chunks: number;
  builtAt: string | null;
  docs: { docId: string; indexed: "fresh" | "stale" | "missing" }[];
};

export type Op = { key: string; jobId: string; label: string; message: string; pct: number | null };

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
  fits: { tone: "ok", icon: "check", word: "Fits" },
  tight: { tone: "warn", icon: "warning", word: "Tight" },
  "gpu-too-small": { tone: "warn", icon: "warning", word: "Partly on the CPU" },
  "ram-too-small": { tone: "err", icon: "error", word: "RAM too small" },
  unknown: { tone: "info", icon: "info", word: "Not measured" },
  untested: { tone: "warn", icon: "warning", word: "Untested here" },
  unsupported: { tone: "err", icon: "error", word: "Not supported here" },
};

export const STATE: Record<ModelState, { tone: BadgeTone; icon: IconName; word: string }> = {
  available: { tone: "line", icon: "pull", word: "Not installed" },
  downloading: { tone: "info", icon: "pull", word: "Downloading" },
  installed: { tone: "neutral", icon: "check", word: "Installed" },
  verified: { tone: "ok", icon: "checked", word: "Verified" },
  active: { tone: "ok", icon: "check", word: "In use" },
  broken: { tone: "err", icon: "error", word: "Broken" },
  outdated: { tone: "warn", icon: "clock", word: "Outdated" },
};

export const ORIGIN: Record<Activation, string> = {
  machine: "This PC's choice",
  reference: "The team reference",
  project: "The project's model (v1 setting)",
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

export function lighterPack(rows: PackRow[], id: string): PackRow | null {
  for (const p of PACK_ORDER.slice(PACK_ORDER.indexOf(id) + 1)) {
    const r = rows.find((x) => x.id === p);
    if (r?.available) return r;
  }
  return null;
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
