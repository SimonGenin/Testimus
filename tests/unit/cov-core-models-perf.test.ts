import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentOp,
  journalFile,
  notePartial,
  type PerfFields,
  type PerfRecord,
  perfStats,
  prunePerf,
  readPerf,
  recordPerf,
  speedLine,
  timeLoad,
  timeOp,
} from "../../src/core/lib/models-perf.ts";
import type { PerfOp } from "../../src/core/types.ts";

const f: PerfFields = { model: "m1", runtime: "mock", device: "cpu" };
const rec = (over: Partial<PerfRecord> = {}): PerfRecord => ({
  at: new Date().toISOString(),
  op: "embed.query",
  model: "m1",
  items: 1,
  ms: 10,
  ...over,
});

beforeEach(() => rmSync(journalFile(), { force: true }));
afterEach(() => rmSync(journalFile(), { force: true }));

describe("journal", () => {
  it("ignores a line with an unknown operation", () => {
    recordPerf(rec({ op: "nope" as PerfOp }));
    expect(readPerf()).toEqual([]);
  });

  it("prune drops unreadable and old lines, emptying the file when nothing is left", () => {
    mkdirSync(dirname(journalFile()), { recursive: true });
    writeFileSync(journalFile(), `not json\n${JSON.stringify(rec({ at: "2000-01-01T00:00:00Z" }))}\n`);
    expect(prunePerf()).toBe(2);
    expect(existsSync(journalFile())).toBe(true);
    expect(readFileSync(journalFile(), "utf8")).toBe("");
  });
});

describe("timeOp and timeLoad", () => {
  it("notePartial does nothing outside an operation and is kept once true inside", async () => {
    notePartial(true);
    expect(currentOp()).toBeUndefined();
    await timeOp("embed.query", f, 1, async () => {
      notePartial(true);
      notePartial(false);
    });
    expect(readPerf()[0]).toMatchObject({ op: "embed.query", partialOffload: true });
  });

  it("a memory failure inside an operation is journaled once, a load failure for memory counts for it", async () => {
    await expect(
      timeOp("embed.query", f, 1, async () => {
        throw new Error("CUDA out of memory");
      }),
    ).rejects.toThrow(/out of memory/);
    expect(readPerf()).toMatchObject([{ op: "embed.query", oom: true, items: 0 }]);
    rmSync(journalFile(), { force: true });
    await expect(
      timeOp("embed.query", f, 1, () =>
        timeLoad(f, async () => {
          throw new Error("failed to allocate");
        }),
      ),
    ).rejects.toThrow(/allocate/);
    expect(readPerf().map((l) => l.op)).toEqual(["model.load"]);
    await expect(
      timeOp("embed.query", f, 1, async () => {
        throw new Error("plain failure");
      }),
    ).rejects.toThrow();
    expect(readPerf()).toHaveLength(1);
  });

  it("a load measured as partly offloaded marks its operation", async () => {
    await timeOp("embed.query", f, 1, () =>
      timeLoad(
        f,
        async () => 1,
        () => ({ partialOffload: true }),
      ),
    );
    expect(readPerf().find((l) => l.op === "embed.query")).toMatchObject({ partialOffload: true });
  });
});

describe("stats", () => {
  it("filters by model; lines without model or device group under empty keys", () => {
    const lines = [rec(), rec({ model: "m2" }), { at: rec().at, op: "search.total", items: 1, ms: 5 } as PerfRecord];
    expect(perfStats({ model: "m1", lines }).map((s) => s.model)).toEqual(["m1"]);
    expect(perfStats({ lines }).find((s) => s.op === "search.total")).toMatchObject({ model: "", device: "" });
  });

  it("speed in seconds above a second; a model whose only lines failed has no speed", () => {
    const stats = perfStats({ lines: [rec({ ms: 1500 }), rec({ model: "m3", oom: true })] });
    expect(speedLine("m1", stats)).toBe("on this PC: query 1.5 s");
    expect(speedLine("m3", stats)).toBeUndefined();
    const two = perfStats({
      lines: [rec({ device: "cpu", ms: 40 }), rec({ device: "gpu", ms: 8 }), rec({ device: "gpu", ms: 8 })],
    });
    expect(speedLine("m1", two)).toBe("on this PC: query 8 ms");
  });
});
