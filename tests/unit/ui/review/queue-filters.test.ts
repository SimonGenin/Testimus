import { describe, expect, it } from "vitest";
import { filtered, keepQueued, NO_FILTER, queueOptions } from "../../../../src/ui/screens/review/queueFilters.ts";
import type { QueueItem } from "../../../../src/ui/screens/review/ReviewQueue.tsx";

const q = (id: string, o: Partial<QueueItem> = {}): QueueItem => ({
  id,
  summary: `Summary ${id}`,
  folder: "/F",
  review: "draft",
  unchecked: false,
  errors: 0,
  warnings: 0,
  infos: 0,
  stale: false,
  mtime: 1,
  ...o,
});

const Q = [
  q("a", { errors: 2, review: "to-fix" }),
  q("b", { warnings: 1, stale: true, folder: "/F/sub" }),
  q("c", { infos: 3, folder: "/G", summary: "Écran de démarrage" }),
  q("d", { unchecked: true, errors: 0, folder: "/G" }),
];

describe("the review queue's filters", () => {
  it("ticks of one menu add up, menus narrow each other", () => {
    const ids = (f: Partial<typeof NO_FILTER>) => keepQueued(Q, { ...NO_FILTER, ...f }).map((t) => t.id);
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
    expect(ids({ checks: ["errors", "warnings"] })).toEqual(["a", "b"]);
    expect(ids({ checks: ["clean"] })).toEqual(["c"]);
    expect(ids({ checks: ["unchecked", "stale"] })).toEqual(["b", "d"]);
    expect(ids({ states: ["to-fix"] })).toEqual(["a"]);
    expect(ids({ folders: ["/F"] })).toEqual(["a", "b"]);
    expect(ids({ folders: ["/G"], checks: ["clean"] })).toEqual(["c"]);
    expect(ids({ words: "ecran demarr" })).toEqual(["c"]);
  });

  it("says when a filter is on, and counts each tick with the other filters as they are", () => {
    expect(filtered(NO_FILTER)).toBe(false);
    expect(filtered({ ...NO_FILTER, words: "  " })).toBe(false);
    expect(filtered({ ...NO_FILTER, folders: ["/G"] })).toBe(true);
    const o = queueOptions(Q, { ...NO_FILTER, folders: ["/G"] });
    expect(o.states.map((s) => [s.value, s.count])).toEqual([
      ["draft", 2],
      ["to-fix", 0],
    ]);
    expect(o.checks.map((c) => [c.value, c.count])).toEqual([
      ["errors", 0],
      ["warnings", 0],
      ["clean", 1],
      ["unchecked", 1],
      ["stale", 0],
    ]);
    expect(o.folders.map((f) => [f.value, f.count])).toEqual([
      ["/F", 2],
      ["/F/sub", 1],
      ["/G", 2],
    ]);
  });
});
