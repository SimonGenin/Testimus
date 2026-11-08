import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { conversionsAtOnce } from "../../../../src/core/lib/agents.ts";
import { conversionSlot, indexAfterConversions } from "../../../../src/core/lib/docs-index.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
  writeSettings(DEFAULT_SETTINGS);
});

const agents = (max: number) => writeSettings({ ...DEFAULT_SETTINGS, agents: { max, adaptive: false } });

function deferred() {
  let open = () => {};
  let fail = (_e: Error) => {};
  const p = new Promise<void>((ok, ko) => {
    open = ok;
    fail = ko;
  });
  return { p, open, fail };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("how many conversions at a time", () => {
  it("is the agents setting, fewer on a PC with few cores or little free memory when adaptive", () => {
    expect(conversionsAtOnce({ max: 5, adaptive: false }, 2, 100)).toBe(5);
    expect(conversionsAtOnce({ max: 5, adaptive: true }, 16, 32_000)).toBe(5);
    expect(conversionsAtOnce({ max: 5, adaptive: true }, 4, 32_000)).toBe(3);
    expect(conversionsAtOnce({ max: 5, adaptive: true }, 16, 2_500)).toBe(2);
    expect(conversionsAtOnce({ max: 5, adaptive: true }, 1, 300)).toBe(1);
  });
});

describe("the conversion slots of a project", () => {
  it("run as many conversions as the setting allows, the others wait their turn; a failure frees its slot", async () => {
    agents(2);
    const P = fixtureCopy("slots");
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let most = 0;
    const waited: number[] = [];
    const runs = gates.map((g, i) =>
      conversionSlot(
        P,
        async () => {
          active++;
          most = Math.max(most, active);
          try {
            await g.p;
            return i;
          } finally {
            active--;
          }
        },
        { onWait: () => waited.push(i) },
      ),
    );
    await tick();
    expect(active).toBe(2);
    expect(waited).toEqual([2, 3]);
    gates[0].fail(new Error("unreadable"));
    await tick();
    expect(active).toBe(2);
    gates[1].open();
    gates[2].open();
    gates[3].open();
    const ends = await Promise.allSettled(runs);
    expect(ends.map((e) => e.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
    expect(most).toBe(2);
  });

  it("make an index run wait for every conversion asked for, those waiting for a slot included", async () => {
    agents(1);
    const P = fixtureCopy("slots-index");
    const a = deferred();
    const b = deferred();
    const order: string[] = [];
    const one = conversionSlot(P, async () => {
      await a.p;
      order.push("a");
    });
    const two = conversionSlot(P, async () => {
      await b.p;
      order.push("b");
    });
    const index = indexAfterConversions(P, async () => {
      order.push("index");
    });
    a.open();
    await one;
    await tick();
    expect(order).toEqual(["a"]);
    b.open();
    await Promise.all([two, index]);
    expect(order).toEqual(["a", "b", "index"]);
  });
});

describe("several documents converted together", () => {
  it("convert a few at a time, each in its own job; one that fails stops none of the others; the index runs once after", async () => {
    agents(2);
    const P = fixtureCopy("parallel");
    const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
    for (const n of ["PA", "PB", "PC", "PD"]) writeFileSync(join(dir, `SPEC_${n}_01_00.docx`), sampleDocx());
    writeFileSync(join(dir, "SPEC_PX_01_00.docx"), "not a zip");
    const r = await call<{ converted: { id: string; status: string }[] }>(
      "docs.addFolder",
      { dir, describeFigures: false },
      P,
    );
    expect(r.converted.map((c) => [c.id, c.status])).toEqual([
      ["SPEC_PA", "done"],
      ["SPEC_PB", "done"],
      ["SPEC_PC", "done"],
      ["SPEC_PD", "done"],
      ["SPEC_PX", "failed"],
    ]);
    const jobs = listJobs(P);
    const converts = jobs.filter((j) => j.kind === "docs.convert");
    expect(converts).toHaveLength(5);
    const waited = converts.filter((j) => j.steps?.some((s) => s.id === "queue" && s.status === "done"));
    expect(waited.length).toBeGreaterThanOrEqual(3);
    expect(jobs.filter((j) => j.kind === "rag-index")).toHaveLength(1);
    const listed = await call<{ id: string; indexed: string }[]>("docs.list", {}, P);
    expect(
      listed
        .filter((d) => d.id.startsWith("SPEC_P") && d.id !== "SPEC_PX")
        .map((d) => d.indexed)
        .every((s) => s === "fresh"),
    ).toBe(true);
  });
});
