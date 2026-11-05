import { existsSync, readFileSync } from "node:fs";

import { env } from "../../env.ts";
import type { DriveInfo, GpuInfo, MachineProfile } from "../../types.ts";
import { mergeGpus, rankGpus, usableGpus } from "./gpus.ts";
import { type HardwareDeps, hardwareDeps } from "./probes.ts";
import { parseNvidiaSmi, parseRegistryVram, parseWmi } from "./sources.ts";

const GPU_CLASS = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const none = { code: 1, stdout: "" };

export async function measureMachine(deps: HardwareDeps = hardwareDeps): Promise<MachineProfile> {
  const win = process.platform === "win32";
  const [smi, wmi, regSize, regDesc, loaded, llama] = await Promise.all([
    deps
      .exec("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv"], 10000)
      .catch(() => none),
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
      : Promise.resolve(none),
    win
      ? deps.exec("reg.exe", ["query", GPU_CLASS, "/s", "/v", "HardwareInformation.qwMemorySize"], 10000)
      : Promise.resolve(none),
    win ? deps.exec("reg.exe", ["query", GPU_CLASS, "/s", "/v", "DriverDesc"], 10000) : Promise.resolve(none),
    deps.loaded().catch(() => []),
    deps.llamaDevices ? deps.llamaDevices().catch(() => []) : Promise.resolve([]),
  ]);
  const onnx = deps.onnx ? await deps.onnx() : undefined;
  const gpus = mergeGpus({
    nvidia: smi.code === 0 ? parseNvidiaSmi(smi.stdout) : [],
    wmi: parseWmi(wmi.stdout),
    registry: parseRegistryVram(regSize.stdout, regDesc.stdout),
    llama,
  });
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
    gpus: rankGpus(gpus),
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

// The GPU models are placed on: a usable discrete one first, else an integrated one, else none
export function mainGpu(machine: MachineProfile): GpuInfo | null {
  return usableGpus(machine.gpus)[0] ?? null;
}
