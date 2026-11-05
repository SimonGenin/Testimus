import { existsSync, statfsSync } from "node:fs";
import os from "node:os";

import { run } from "../../../shared/run/process.ts";
import { onnxVersion } from "../../rag/runtimes/ort.ts";
import type { LoadedModel } from "../../types.ts";
import { type LlamaDevice, parseLlamaDevices } from "./sources.ts";

const MB = 1024 * 1024;

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
  llamaDevices?(): Promise<LlamaDevice[]>;
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
    return (await import("../../rag/runtimes/llama-server.ts")).loadedServers();
  } catch {
    return [];
  }
}

// ponytail: the GPUs as the installed llama.cpp sees them, with their free memory — the one source of it for AMD and
// Intel; nothing when llama.cpp is not installed or is its processor build
async function llamaDevices(): Promise<LlamaDevice[]> {
  try {
    const b = (await import("../../rag/runtimes/llamacpp.ts")).installedLlama();
    if (!b || b.backend === "cpu") return [];
    const r = await exec(b.exe, ["--list-devices"], 20000);
    return r.code === 0 ? parseLlamaDevices(r.stdout) : [];
  } catch {
    return [];
  }
}

// ponytail: a seam env does not have — the probes of the machine (nvidia-smi, WMI, the registry, llama.cpp, statfs,
// memory), which the tests answer to play a PC Testimus does not run on
export const hardwareDeps: HardwareDeps = {
  exec,
  statfs,
  drives,
  loaded: loadedModels,
  mem: () => ({ totalMB: Math.floor(os.totalmem() / MB), freeMB: Math.floor(os.freemem() / MB) }),
  cpu: () => ({ model: os.cpus()[0]?.model.trim() ?? "unknown", threads: os.cpus().length }),
  system: () => ({ platform: process.platform, arch: process.arch }),
  onnx: () => onnxVersion().catch(() => null),
  llamaDevices,
};
