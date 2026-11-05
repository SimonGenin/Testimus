import type { GpuInfo } from "../../types.ts";
import { isVirtual } from "./gpus.ts";

const MB = 1024 * 1024;
// ponytail: a registry size under 64 MiB is a value in the wrong unit (the WDK documents megabytes, drivers write
// bytes), never a real adapter: it is dropped, not trusted (llmfit, MIT, Alex Jones)
const MIN_PLAUSIBLE_BYTES = 64 * MB;

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
      .filter((g): g is { Name: string; DriverVersion?: string } => typeof g?.Name === "string" && !!g.Name.trim())
      .filter((g) => !isVirtual(g.Name))
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
    if (Number.isFinite(bytes) && bytes >= MIN_PLAUSIBLE_BYTES) out.set(name, Math.round(bytes / MB));
  }
  return out;
}

export type LlamaDevice = { id: string; name: string; totalMB: number; freeMB: number };

// ponytail: the lines common_print_available_devices prints for `llama-server --list-devices` (llama.cpp b12032,
// common/arg.cpp): « Available devices: » then «   CUDA0: NVIDIA GeForce RTX 5080 (16302 MiB, 14980 MiB free) »
export function parseLlamaDevices(text: string): LlamaDevice[] {
  const out: LlamaDevice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s+([A-Za-z][\w-]*\d+):\s+(.+?)\s+\((\d+) MiB, (\d+) MiB free\)\s*$/);
    if (m) out.push({ id: m[1], name: m[2], totalMB: Number(m[3]), freeMB: Number(m[4]) });
  }
  return out;
}
