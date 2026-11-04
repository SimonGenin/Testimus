import { when } from "./ReviewBanners.tsx";

type Queued = { id: string; mtime: number; generatedBy?: string; generatedAt?: string };

export type QueueGroup = { label: string; meta: string; keys: string[] };

const startOf = (items: Queued[], g: string) =>
  items
    .filter((t) => t.generatedBy === g)
    .reduce(
      (best, t) => {
        const at = t.generatedAt ?? "";
        return at > best.at || (at === best.at && t.mtime > best.mtime) ? { at, mtime: t.mtime } : best;
      },
      { at: "", mtime: 0 },
    );

// ponytail: the latest generation's tests first, under « Generated <when> », then « Earlier »; one generation in the
// queue needs no group. Inside a group the order asked (sort) is kept, and J/K walk the order shown
export function byGeneration<T extends Queued>(items: T[]): { items: T[]; groups?: QueueGroup[] } {
  const gens = [...new Set(items.map((t) => t.generatedBy ?? ""))];
  if (gens.length < 2) return { items };
  const starts = new Map(gens.map((g) => [g, startOf(items, g)]));
  const latest = gens.reduce((a, b) => {
    const x = starts.get(a) ?? { at: "", mtime: 0 };
    const y = starts.get(b) ?? { at: "", mtime: 0 };
    return y.at > x.at || (y.at === x.at && y.mtime > x.mtime) ? b : a;
  });
  const recent = items.filter((t) => (t.generatedBy ?? "") === latest);
  const earlier = items.filter((t) => (t.generatedBy ?? "") !== latest);
  const head = recent.find((t) => t.generatedAt)?.generatedAt;
  const latestStart = starts.get(latest);
  const label = head
    ? `Generated ${when(head)}`
    : latestStart?.mtime
      ? `Generated ${when(new Date(latestStart.mtime).toISOString())}`
      : "Latest generation";
  return {
    items: [...recent, ...earlier],
    groups: [
      { label, meta: String(recent.length), keys: recent.map((t) => t.id) },
      { label: "Earlier", meta: String(earlier.length), keys: earlier.map((t) => t.id) },
    ],
  };
}
