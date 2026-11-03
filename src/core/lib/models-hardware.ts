import { existsSync, readFileSync, statfsSync } from "node:fs";
import os from "node:os";
import { win32 } from "node:path";
import { run } from "../../shared/run/process.ts";
import { env } from "../env.ts";
import { onnxVersion } from "../rag/runtimes/ort.ts";
import type { DriveInfo, GpuInfo, LoadedModel, MachineProfile } from "../types.ts";

const MB = 1024 * 1024;
const GPU_CLASS = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const VIRTUAL = /remote display|basic display|basic render|virtual|parsec|citrix/i;

export type ExecOut = { code: number; stdout: string };
export type HardwareDeps = {
  exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecOut>;
  statfs(root: string): { freeMB: number; totalMB: number } | null;
  drives(): string[];
  loaded(): Promise<LoadedModel[]>;
  mem(): { totalMB: number; freeMB: number };
  cpu(): { model: string; threads: number };
  system?(): { platform: string; arch: string };
  onnx?(): Promise<string | null>;
};

async function exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecOut> {
  const r = await run({ exe: cmd, args, timeoutMs });
  return { code: r.error ? 1 : r.code, stdout: r.stdout };
}

function statfs(root: string): { freeMB: number; totalMB: number } | null {
  try {
    const s = statfsSync(root);
    return { freeMB: Math.floor((s.bavail * s.bsize) / MB), totalMB: Math.floor((s.blocks * s.bsize) / MB) };
  } catch {
    return null;
  }
}

function drives(): string[] {
  if (process.platform !== "win32") return [os.homedir()];
  const out: string[] = [];
  for (let c = 67; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (existsSync(root)) out.push(root);
  }
  return out;
}

async function loadedModels(): Promise<LoadedModel[]> {
  try {
    return (await import("../rag/runtimes/llama-server.ts")).loadedServers();
  } catch {
    return [];
  }
}

export const hardwareDeps: HardwareDeps = {
  exec,
  statfs,
  drives,
  loaded: loadedModels,
  mem: () => ({ totalMB: Math.floor(os.totalmem() / MB), freeMB: Math.floor(os.freemem() / MB) }),
  cpu: () => ({ model: os.cpus()[0]?.model.trim() ?? "unknown", threads: os.cpus().length }),
  system: () => ({ platform: process.platform, arch: process.arch }),
  onnx: () => onnxVersion().catch(() => null),
};

export function vendorOf(name: string): GpuInfo["vendor"] {
  if (/nvidia|geforce|quadro|rtx/i.test(name)) return "nvidia";
  if (/amd|radeon/i.test(name)) return "amd";
  if (/intel|arc\b/i.test(name)) return "intel";
  return "other";
}

const num = (s: string | undefined): number | null => {
  const n = Number.parseFloat((s ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseNvidiaSmi(csv: string): GpuInfo[] {
  const out: GpuInfo[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 4 || /^name$/i.test(cells[0])) continue;
    out.push({
      name: cells[0],
      vendor: "nvidia",
      driver: cells[1],
      vramTotalMB: num(cells[2]),
      vramUsedMB: num(cells[3]),
      source: "nvidia-smi",
    });
  }
  return out;
}

export function parseWmi(json: string): { name: string; driver?: string }[] {
  try {
    const raw = JSON.parse(json) as { Name?: string; DriverVersion?: string } | { Name?: string }[];
    const list = Array.isArray(raw) ? raw : [raw];
    return list
      .filter((g): g is { Name: string; DriverVersion?: string } => typeof g?.Name === "string")
      .filter((g) => !VIRTUAL.test(g.Name))
      .map((g) => ({ name: g.Name.trim(), ...(g.DriverVersion ? { driver: g.DriverVersion } : {}) }));
  } catch {
    return [];
  }
}

export function parseRegistryVram(sizes: string, descs: string): Map<string, number> {
  const byKey = (text: string, value: string) => {
    const m = new Map<string, string>();
    let key = "";
    for (const line of text.split(/\r?\n/)) {
      if (/^HKEY_/i.test(line.trim())) key = line.trim();
      const hit = line.match(new RegExp(`^\\s+${value.replace(/\./g, "\\.")}\\s+REG_\\w+\\s+(.+)$`));
      if (hit && key) m.set(key, hit[1].trim());
    }
    return m;
  };
  const size = byKey(sizes, "HardwareInformation.qwMemorySize");
  const out = new Map<string, number>();
  for (const [key, name] of byKey(descs, "DriverDesc")) {
    const raw = size.get(key);
    if (!raw) continue;
    const bytes = raw.startsWith("0x") ? Number.parseInt(raw, 16) : Number(raw);
    if (Number.isFinite(bytes) && bytes > 0) out.set(name, Math.round(bytes / MB));
  }
  return out;
}

export async function measureMachine(deps: HardwareDeps = hardwareDeps): Promise<MachineProfile> {
  const win = process.platform === "win32";
  const [smi, wmi, regSize, regDesc, loaded] = await Promise.all([
    deps
      .exec("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv"], 10000)
      .catch(() => ({ code: 1, stdout: "" })),
    win
      ? deps.exec(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress",
          ],
          15000,
        )
      : Promise.resolve({ code: 1, stdout: "" }),
    win
      ? deps.exec("reg.exe", ["query", GPU_CLASS, "/s", "/v", "HardwareInformation.qwMemorySize"], 10000)
      : Promise.resolve({ code: 1, stdout: "" }),
    win
      ? deps.exec("reg.exe", ["query", GPU_CLASS, "/s", "/v", "DriverDesc"], 10000)
      : Promise.resolve({ code: 1, stdout: "" }),
    deps.loaded().catch(() => []),
  ]);
  const onnx = deps.onnx ? await deps.onnx() : undefined;
  const nvidia = smi.code === 0 ? parseNvidiaSmi(smi.stdout) : [];
  const regVram = parseRegistryVram(regSize.stdout, regDesc.stdout);
  const gpus: GpuInfo[] = [...nvidia];
  for (const g of parseWmi(wmi.stdout)) {
    if (gpus.some((n) => n.name.toLowerCase() === g.name.toLowerCase())) continue;
    const vendor = vendorOf(g.name);
    if (vendor === "nvidia" && nvidia.length) continue;
    const vram = regVram.get(g.name) ?? null;
    gpus.push({
      name: g.name,
      vendor,
      ...(g.driver ? { driver: g.driver } : {}),
      vramTotalMB: vram,
      vramUsedMB: null,
      source: vram === null ? "wmi" : "registry",
    });
  }
  const drives: DriveInfo[] = [];
  for (const root of deps.drives()) {
    const s = deps.statfs(root);
    if (s) drives.push({ root, ...s });
  }
  const mem = deps.mem();
  return {
    at: env.now().toISOString(),
    ...(deps.system ? { system: deps.system() } : {}),
    ...(onnx !== undefined ? { onnx } : {}),
    ramTotalMB: mem.totalMB,
    ramFreeMB: mem.freeMB,
    cpu: deps.cpu(),
    gpus,
    drives,
    loaded,
  };
}

let cached: MachineProfile | null = null;
let pinned: MachineProfile | null = null;

export async function machineProfile(opts: { refresh?: boolean } = {}): Promise<MachineProfile> {
  const file = process.env.TESTIMUS_MACHINE;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as MachineProfile;
  if (pinned) return pinned;
  const fresh = cached && env.now().getTime() - Date.parse(cached.at) < 10 * 60 * 1000;
  if (!opts.refresh && fresh && cached) return cached;
  cached = await measureMachine();
  return cached;
}

export function knownMachine(): MachineProfile | null {
  return pinned ?? cached;
}

export function pinMachineProfile(p: MachineProfile | null): void {
  pinned = p;
}

export function driveOf(machine: MachineProfile, path: string): DriveInfo | undefined {
  const root = win32.parse(path).root.toLowerCase();
  const under = (r: string) => {
    const base = r.replace(/\/+$/, "");
    return path === base || path.startsWith(`${base}/`);
  };
  return machine.drives.find((d) => (d.root.startsWith("/") ? under(d.root) : d.root.toLowerCase() === root));
}

// ponytail: a profile without a system (an imposed profile written before it existed) is the Windows PC it was taken on
export function platformOf(machine: MachineProfile): string {
  return machine.system?.platform ?? "win32";
}

export function systemName(platform: string): string {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
}

export function systemOf(machine: MachineProfile): string {
  return `${platformOf(machine)}-${machine.system?.arch ?? "x64"}`;
}

export function mainGpu(machine: MachineProfile): GpuInfo | null {
  const real = machine.gpus.filter((g) => !VIRTUAL.test(g.name));
  if (!real.length) return null;
  return [...real].sort((a, b) => (b.vramTotalMB ?? -1) - (a.vramTotalMB ?? -1))[0];
}
