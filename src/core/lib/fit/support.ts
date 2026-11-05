import type { CatalogEntry, MachineProfile, PerfLine } from "../../types.ts";
import { platformOf, systemOf } from "../machine/profile.ts";
import { readPerf } from "../models-perf.ts";

// ponytail: llama.cpp is downloaded as its Windows x64 builds only (LLAMA_ASSETS) and DirectML is Windows' own; the
// 16-bit DirectML variants exist for the GPU, so elsewhere their 8-bit processor twin is the one to run
export function unsupportedOn(entry: CatalogEntry, machine: MachineProfile): string | null {
  if (machine.onnx === null && entry.runtimes.includes("transformers"))
    return "runs on onnxruntime, which does not load on this PC (see Settings › Doctor)";
  if (platformOf(machine) === "win32") return null;
  if (!entry.runtimes.includes("transformers")) return "runs on llama.cpp, which Testimus ships for Windows only";
  if (entry.dtypeByDevice?.dml) return "is made for DirectML, which exists only on Windows";
  return null;
}

// ponytail: the catalog is proven on Windows x64, the reference PC; elsewhere the runtime differs (onnxruntime 1.23.2 on
// an Intel Mac) and a model counts as proven by the catalog's `provenOn` or by a load that succeeded on this PC
export function untestedOn(entry: CatalogEntry, machine: MachineProfile, lines?: PerfLine[]): boolean {
  const system = systemOf(machine);
  if (system === "win32-x64" || entry.provenOn?.includes(system)) return false;
  return !(lines ?? readPerf()).some((l) => l.op === "model.load" && l.model === entry.id && l.items > 0 && !l.oom);
}
