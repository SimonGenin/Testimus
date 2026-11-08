import { join } from "node:path";
import catalogJson from "../../../models/catalog.json" with { type: "json" };
import { UserError } from "../command.ts";
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

export function needEntry(id: string): CatalogEntry {
  const e = catalogEntry(id);
  if (!e) throw new UserError(`Unknown model ${id}.`, "testimus models catalog lists the catalog ids.");
  return e;
}

// ponytail: the catalog entries of a pair of models (a pack's variant, a choice, a command's input) — an empty slot is
// skipped, an id the catalog does not know is refused
export function entriesOf(ids: (string | null | undefined)[]): CatalogEntry[] {
  return ids.filter((m): m is string => !!m).map((m) => needEntry(m));
}
