import { join } from "node:path";
import type { Budgets, Installation, InstallVia, ModelsRegistry } from "../types.ts";
import { registryFile } from "./models-catalog.ts";
import { readJson, readSettings, writeJson } from "./project.ts";

export const DEFAULT_BUDGETS: Budgets = { queryMs: 1000, indexPassagesPerSec: 5, headroom: 0.15 };

export function readRegistry(): ModelsRegistry {
  const raw = readJson<Partial<ModelsRegistry>>(registryFile(), {});
  return { ...raw, allowRemote: raw.allowRemote ?? readSettings().models.allowRemote, installs: raw.installs ?? [] };
}

export function writeRegistry(r: ModelsRegistry): void {
  writeJson(registryFile(), r);
}

export function updateRegistry(change: (r: ModelsRegistry) => void): ModelsRegistry {
  const r = readRegistry();
  change(r);
  writeRegistry(r);
  return r;
}

export function modelsDir(r: ModelsRegistry = readRegistry()): string | undefined {
  return r.dir || undefined;
}

export function runtimesDir(r: ModelsRegistry = readRegistry()): string | undefined {
  return r.runtimesDir || (r.dir ? join(r.dir, "runtimes") : undefined);
}

export function installsOf(model: string, r: ModelsRegistry = readRegistry()): Installation[] {
  return r.installs.filter((i) => i.model === model);
}

export function putInstall(inst: Installation): ModelsRegistry {
  return updateRegistry((r) => {
    r.installs = [...r.installs.filter((i) => !(i.model === inst.model && i.via === inst.via)), inst];
  });
}

export function dropInstall(model: string, via?: InstallVia): ModelsRegistry {
  return updateRegistry((r) => {
    r.installs = r.installs.filter((i) => !(i.model === model && (!via || i.via === via)));
  });
}

export function budgets(): Budgets {
  return { ...DEFAULT_BUDGETS, ...readSettings().rag?.budgets };
}
