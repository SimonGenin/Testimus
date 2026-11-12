import { localTree, treeOrder } from "../../components/tree/tree.ts";
import { when } from "./ReviewBanners.tsx";

type Queued = {
  id: string;
  summary: string;
  folder: string;
  mtime: number;
  generatedBy?: string;
  generatedAt?: string;
};

// the order the queue draws: folder by folder, as the Tests screen files them, the sort asked kept inside a folder
const inTree = <T extends Queued>(items: T[]): T[] => treeOrder(localTree(items, false));

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
// queue needs no group. Inside a group the tests are filed by folder, the order asked (sort) kept inside a folder, and
// J/K walk the order shown
export function byGeneration<T extends Queued>(items: T[]): { items: T[]; groups?: QueueGroup[] } {
  const gens = [...new Set(items.map((t) => t.generatedBy ?? ""))];
  if (gens.length < 2) return { items: inTree(items) };
  const starts = new Map(gens.map((g) => [g, startOf(items, g)]));
  const latest = gens.reduce((a, b) => {
    const x = starts.get(a) ?? { at: "", mtime: 0 };
    const y = starts.get(b) ?? { at: "", mtime: 0 };
    return y.at > x.at || (y.at === x.at && y.mtime > x.mtime) ? b : a;
  });
  const recent = inTree(items.filter((t) => (t.generatedBy ?? "") === latest));
  const earlier = inTree(items.filter((t) => (t.generatedBy ?? "") !== latest));
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
