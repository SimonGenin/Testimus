import { join } from "node:path";
import catalogJson from "../../../models/catalog.json" with { type: "json" };
import { env } from "../env.ts";
import type { Catalog, CatalogEntry, ModelsRegistry, Pack } from "../types.ts";
import { readJson } from "./project.ts";

export const SHIPPED = catalogJson as Catalog;

export function registryFile(): string {
  return join(env.dataDir(), "models.json");
}

export function catalog(): Catalog {
  const own = readJson<Partial<ModelsRegistry>>(registryFile(), {}).catalog ?? [];
  const ids = new Set(own.map((e) => e.id));
  return { ...SHIPPED, entries: [...SHIPPED.entries.filter((e) => !ids.has(e.id)), ...own] };
}

export function catalogEntry(id: string, c: Catalog = catalog()): CatalogEntry | undefined {
  return c.entries.find((e) => e.id === id);
}

export function pack(id: string, c: Catalog = catalog()): Pack | undefined {
  return c.packs.find((p) => p.id === id);
}
