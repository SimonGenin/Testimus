import { useRead } from "../../../lib/data/query.ts";

// ponytail: a model's name from its id (the catalog's label), the id itself until the catalog is read
export function useModelLabel(): (id: string) => string {
  const catalog = useRead("models.catalog", {});
  const labels = new Map((catalog.data ?? []).map((c) => [c.id, c.label]));
  return (id: string) => labels.get(id) ?? id;
}
