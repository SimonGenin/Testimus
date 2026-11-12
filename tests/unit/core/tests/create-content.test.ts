import { describe, expect, it } from "vitest";
import { mechanicalCheck } from "../../../../src/core/lib/check.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { isSkeleton } from "../../../../src/core/lib/testfile.ts";
import { call, fixtureCopy } from "../registry.ts";

const SRC = 'SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"';

describe("tests.create writes a whole test in one call", () => {
  it("summary, description and steps with their sources; no step given is one empty step", async () => {
    const P = fixtureCopy("create");
    const { id } = await call<{ id: string }>(
      "tests.create",
      {
        summary: "Menu du sectionneur",
        folder: "/Traction",
        description: "Vérifie le menu.",
        steps: [
          { fields: { Action: "Clic droit sur le sectionneur.", Expected: "Le menu s'ouvre." }, sources: [SRC] },
          { fields: { Action: "Fermer le menu." } },
        ],
      },
      P,
    );
    const { test } = readTest(P, id);
    expect(test).toMatchObject({
      summary: "Menu du sectionneur",
      folder: "/Traction",
      description: "Vérifie le menu.",
    });
    expect(test.steps.map((s) => s.fields)).toEqual([
      { Action: "Clic droit sur le sectionneur.", "Expected Result": "Le menu s'ouvre." },
      { Action: "Fermer le menu." },
    ]);
    expect(test.steps[0].sources).toMatchObject([{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6" }]);
    expect(isSkeleton(test)).toBe(false);
    const blank = await call<{ id: string }>("tests.create", { summary: "Vide" }, P);
    expect(readTest(P, blank.id).test.steps).toHaveLength(1);
    expect(isSkeleton(readTest(P, blank.id).test)).toBe(true);
    await expect(
      call("tests.create", { steps: [{ fields: { Action: "A" }, sources: ["not a source"] }] }, P),
    ).rejects.toThrow(/is not docId#anchor "quote"/);
  });

  it("the mechanical check warns on a test still called New test and on an empty description", async () => {
    const P = fixtureCopy("create");
    const { id } = await call<{ id: string }>("tests.create", {}, P);
    const test = mechanicalCheck(P, id).filter((f) => f.step === undefined);
    expect(test.map((f) => [f.kind, f.severity, f.message])).toEqual([
      [
        "empty-field",
        "warning",
        "The test is still called « New test »: give it a summary that says what it verifies.",
      ],
      ["empty-field", "warning", "The test has no description: say what it verifies and what the tester starts from."],
    ]);
    expect(mechanicalCheck(P, "LFRPS12-1420").filter((f) => f.step === undefined)).toEqual([]);
  });

  it("an empty draft is a skeleton; a test with any step written is never one", () => {
    const P = fixtureCopy("create");
    const t = readTest(P, "LFRPS12-1420").test;
    expect(isSkeleton(t)).toBe(false);
    expect(isSkeleton({ ...t, summary: "New test", description: "" })).toBe(false);
    const empty = { ...t, steps: [{ fields: { Action: " " }, sources: [], images: [] }] };
    expect(isSkeleton(empty)).toBe(false);
    expect(isSkeleton({ ...empty, description: "" })).toBe(true);
    expect(isSkeleton({ ...empty, summary: "New test" })).toBe(true);
  });
});
