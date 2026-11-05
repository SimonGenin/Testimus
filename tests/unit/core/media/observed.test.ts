import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCorpus, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { lotOfAnchor } from "../../../../src/core/lib/media.ts";
import type { Finding, Source, Step, Test } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const D3 = "SOSIE_211_D401-1_3";
const LOT = "recette-tco-12-10";
const ANNEX: Source = {
  docId: D3,
  anchor: `§lot-${LOT}.img-0043`,
  quote: "elle indique un sectionneur sans télécommande (TK)",
};
const BODY: Source = {
  docId: D3,
  anchor: "§5.6.6",
  quote: "Le menu contextuel d'un sectionneur sans TK propose",
};
let P = "";

const step = (sources: Source[], expected = "La fenêtre Propriétés s'ouvre."): Step => ({
  fields: { Action: "Ouvrir les propriétés du sectionneur S12.", "Expected Result": expected },
  sources,
  images: [],
});
const testOf = (steps: Step[]) => ({ summary: "s", steps }) as unknown as Test;
const observed = (fs: Finding[]) => fs.filter((f) => f.kind === "observed-only");

beforeEach(async () => {
  P = fixtureCopy("observed");
  await call("media.include", { doc: D3, lot: LOT, included: true, index: false }, P);
});

describe("observed-only", () => {
  it("tells an expected result whose every source is an annex, and only that", () => {
    const corpus = loadCorpus(P);
    const fs = mechanicalFindings(
      testOf([
        step([ANNEX]),
        step([ANNEX, BODY]),
        step([{ ...ANNEX, anchor: `fig:lot-${LOT}.img-0043`, quote: "IMG_0043.jpg" }]),
        step([ANNEX], ""),
        step([BODY, { ...ANNEX, column: "Data", item: "S12" }]),
      ]),
      corpus,
    );
    expect(observed(fs).map((f) => [f.step, f.severity, f.sources])).toEqual([
      [1, "warning", [`${D3}#§lot-${LOT}.img-0043`]],
      [3, "warning", [`${D3}#fig:lot-${LOT}.img-0043`]],
    ]);
    expect(observed(fs)[0].message).toMatch(/photos of the real system — they show what it does, not what it must do/);
    // ponytail: the annex quote itself is found at its anchor like any passage of the document
    expect(fs.filter((f) => f.step === 1 && f.kind.startsWith("quote"))).toEqual([]);
  });

  it("says nothing once the team marks the batch as a reference", async () => {
    await call("media.context", { doc: D3, lot: LOT, reference: true, index: false }, P);
    expect(observed(mechanicalFindings(testOf([step([ANNEX])]), loadCorpus(P)))).toEqual([]);
  });

  it("is reported by check.run on a test of the project", async () => {
    const file = join(P, "tests", "LFRPS12-1420", "test.md");
    const md = readFileSync(file, "utf8");
    const first = md.indexOf("### Sources\n");
    const end = md.indexOf("\n## ", first);
    writeFileSync(
      file,
      `${md.slice(0, first)}### Sources\n\n- ${ANNEX.docId}#${ANNEX.anchor} "${ANNEX.quote}"\n${end < 0 ? "" : md.slice(end)}`,
    );
    await call("check.run", { ids: ["LFRPS12-1420"], semantic: false }, P);
    const check = JSON.parse(readFileSync(join(P, "tests", "LFRPS12-1420", "check.json"), "utf8")) as {
      findings: Finding[];
    };
    expect(observed(check.findings)).toHaveLength(1);
  });

  it("reads the batch of an annex anchor however it is written", () => {
    expect(lotOfAnchor(`§lot-${LOT}`)).toBe(LOT);
    expect(lotOfAnchor(`§ lot-${LOT}.img-1`)).toBe(LOT);
    expect(lotOfAnchor(`fig:lot-${LOT}.img-1`)).toBe(LOT);
    expect(lotOfAnchor("§5.6.6")).toBeNull();
    expect(lotOfAnchor("fig:40")).toBeNull();
  });
});
